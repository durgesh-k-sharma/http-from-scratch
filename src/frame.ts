import type {
  Body,
  Limits,
  Method,
  ProtocolFault,
  Request,
  Response,
  StatusCode,
} from "./types.js";
import { STATUS_REASON } from "./types.js";
import type { ParsedHead, RequestLine } from "./phase.js";

const HEADER_END = Buffer.from("\r\n\r\n");
const METHODS = new Set<string>(["GET", "POST", "PUT", "DELETE"]);

export type DecodeResult =
  | { kind: "need-more" }
  | { kind: "fault"; fault: ProtocolFault; consumed: number }
  | { kind: "head"; head: ParsedHead; consumed: number }
  | { kind: "request"; request: Request; consumed: number };

export class FrameBuffer {
  private buf = Buffer.alloc(0);
  private mode: "head" | "body" = "head";
  private pendingHead: ParsedHead | undefined;
  private bodyRemaining = 0;
  private bodyParts: Buffer[] = [];

  constructor(private readonly limits: Limits) {}

  resetForNextRequest(): void {
    this.mode = "head";
    this.pendingHead = undefined;
    this.bodyRemaining = 0;
    this.bodyParts = [];
    // Keep leftover bytes (pipelined) in buf.
  }

  /** Bytes still buffered after a complete message (pipeline leftover). */
  leftover(): Buffer {
    return this.buf;
  }

  dropLeftover(): void {
    this.buf = Buffer.alloc(0);
  }

  clear(): void {
    this.buf = Buffer.alloc(0);
    this.mode = "head";
    this.pendingHead = undefined;
    this.bodyRemaining = 0;
    this.bodyParts = [];
  }

  append(chunk: Uint8Array): DecodeResult {
    this.buf = Buffer.concat([this.buf, Buffer.from(chunk)]);

    if (this.mode === "head") {
      return this.tryParseHead();
    }
    return this.tryParseBody();
  }

  private tryParseHead(): DecodeResult {
    if (this.buf.length > this.limits.maxHeaderBytes) {
      const end = this.buf.indexOf(HEADER_END);
      if (end === -1 || end + 4 > this.limits.maxHeaderBytes) {
        return {
          kind: "fault",
          fault: { code: "headers-too-large", status: 431 },
          consumed: 0,
        };
      }
    }

    const end = this.buf.indexOf(HEADER_END);
    if (end === -1) {
      if (this.buf.length >= this.limits.maxHeaderBytes) {
        return {
          kind: "fault",
          fault: { code: "headers-too-large", status: 431 },
          consumed: 0,
        };
      }
      return { kind: "need-more" };
    }

    const headBytes = this.buf.subarray(0, end);
    const consumed = end + 4;
    const parsed = parseHeadBlock(headBytes, this.limits);
    if (!parsed.ok) {
      return { kind: "fault", fault: parsed.fault, consumed };
    }

    this.buf = this.buf.subarray(consumed);
    const head = parsed.head;

    if (head.contentLength === 0) {
      const request = headToRequest(head, { kind: "none" });
      this.mode = "head";
      return { kind: "request", request, consumed };
    }

    if (head.contentLength > this.limits.maxBodyBytes) {
      return {
        kind: "fault",
        fault: { code: "body-too-large", status: 413 },
        consumed,
      };
    }

    this.mode = "body";
    this.pendingHead = head;
    this.bodyRemaining = head.contentLength;
    this.bodyParts = [];
    return this.tryParseBody();
  }

  private tryParseBody(): DecodeResult {
    const head = this.pendingHead;
    if (!head) {
      return {
        kind: "fault",
        fault: { code: "bad-request", detail: "missing head", status: 400 },
        consumed: 0,
      };
    }

    if (this.buf.length < this.bodyRemaining) {
      this.bodyParts.push(this.buf);
      this.bodyRemaining -= this.buf.length;
      this.buf = Buffer.alloc(0);
      return { kind: "need-more" };
    }

    const bodyChunk = this.buf.subarray(0, this.bodyRemaining);
    this.bodyParts.push(bodyChunk);
    this.buf = this.buf.subarray(this.bodyRemaining);
    const bytes = Buffer.concat(this.bodyParts);
    const request = headToRequest(head, { kind: "bytes", bytes: new Uint8Array(bytes) });
    this.mode = "head";
    this.pendingHead = undefined;
    this.bodyRemaining = 0;
    this.bodyParts = [];
    return { kind: "request", request, consumed: bodyChunk.length };
  }
}

function parseHeadBlock(
  block: Buffer,
  limits: Limits,
): { ok: true; head: ParsedHead } | { ok: false; fault: ProtocolFault } {
  const text = block.toString("latin1");
  const lines = text.split("\r\n");
  if (lines.length < 1 || lines[0] === undefined) {
    return {
      ok: false,
      fault: { code: "bad-request", detail: "empty request", status: 400 },
    };
  }

  const requestLine = parseRequestLine(lines[0], limits);
  if (!requestLine.ok) return requestLine;

  const headers = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.length === 0) continue;
    if (line[0] === " " || line[0] === "\t") {
      return {
        ok: false,
        fault: {
          code: "bad-request",
          detail: "obs-fold not supported",
          status: 400,
        },
      };
    }
    const colon = line.indexOf(":");
    if (colon <= 0) {
      return {
        ok: false,
        fault: { code: "bad-request", detail: "malformed header", status: 400 },
      };
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (!isValidHeaderName(name) || !isValidHeaderValue(value)) {
      return {
        ok: false,
        fault: { code: "bad-request", detail: "invalid header", status: 400 },
      };
    }
    if (name === "host" && headers.has("host")) {
      return {
        ok: false,
        fault: { code: "bad-request", detail: "duplicate Host", status: 400 },
      };
    }
    // Last-wins for non-Host; Host already guarded.
    headers.set(name, value);
  }

  if (requestLine.httpVersion === "1.1" && !headers.has("host")) {
    return {
      ok: false,
      fault: { code: "bad-request", detail: "missing Host", status: 400 },
    };
  }

  const te = headers.get("transfer-encoding");
  if (te !== undefined) {
    return {
      ok: false,
      fault: {
        code: "bad-request",
        detail: "chunked bodies not supported",
        status: 400,
      },
    };
  }

  let contentLength = 0;
  const cl = headers.get("content-length");
  if (cl !== undefined) {
    if (!/^\d+$/.test(cl)) {
      return {
        ok: false,
        fault: { code: "bad-request", detail: "bad Content-Length", status: 400 },
      };
    }
    contentLength = Number(cl);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return {
        ok: false,
        fault: { code: "bad-request", detail: "bad Content-Length", status: 400 },
      };
    }
  } else if (
    requestLine.method === "POST" ||
    requestLine.method === "PUT"
  ) {
    // Allow empty body without Content-Length for simplicity of demos;
    // treat as zero-length.
    contentLength = 0;
  }

  const connection = (headers.get("connection") ?? "").toLowerCase();
  const wantsKeepAlive =
    requestLine.httpVersion === "1.1"
      ? connection !== "close"
      : connection === "keep-alive";

  return {
    ok: true,
    head: {
      requestLine: requestLine.line,
      headers,
      contentLength,
      wantsKeepAlive,
      httpVersion: requestLine.httpVersion,
      path: requestLine.path,
      query: requestLine.query,
    },
  };
}

function parseRequestLine(
  line: string,
  limits: Limits,
):
  | {
      ok: true;
      line: RequestLine;
      method: Method;
      path: string;
      query: Map<string, string>;
      httpVersion: "1.0" | "1.1";
    }
  | { ok: false; fault: ProtocolFault } {
  const parts = line.split(" ");
  if (parts.length !== 3) {
    return {
      ok: false,
      fault: { code: "bad-request", detail: "bad request-line", status: 400 },
    };
  }
  const [methodRaw, target, version] = parts as [string, string, string];

  if (target.length > limits.maxUrlBytes) {
    return { ok: false, fault: { code: "uri-too-long", status: 414 } };
  }

  if (version !== "HTTP/1.1" && version !== "HTTP/1.0") {
    return {
      ok: false,
      fault: { code: "unsupported-version", version, status: 505 },
    };
  }

  if (!METHODS.has(methodRaw)) {
    return {
      ok: false,
      fault: { code: "unsupported-method", method: methodRaw, status: 501 },
    };
  }

  if (target.startsWith("http://") || target.startsWith("https://")) {
    return {
      ok: false,
      fault: {
        code: "bad-request",
        detail: "absolute-form not supported",
        status: 400,
      },
    };
  }

  if (!target.startsWith("/")) {
    return {
      ok: false,
      fault: { code: "bad-request", detail: "bad target", status: 400 },
    };
  }

  const q = target.indexOf("?");
  const pathRaw = q === -1 ? target : target.slice(0, q);
  const queryRaw = q === -1 ? "" : target.slice(q + 1);

  let path: string;
  try {
    path = decodeURIComponent(pathRaw);
  } catch {
    return {
      ok: false,
      fault: { code: "bad-request", detail: "bad path encoding", status: 400 },
    };
  }

  const query = parseQuery(queryRaw);
  const httpVersion = version === "HTTP/1.0" ? "1.0" : "1.1";
  return {
    ok: true,
    line: { method: methodRaw, target, version },
    method: methodRaw as Method,
    path,
    query,
    httpVersion,
  };
}

export function parseQuery(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const part of raw.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const k = eq === -1 ? part : part.slice(0, eq);
    const v = eq === -1 ? "" : part.slice(eq + 1);
    try {
      map.set(decodeURIComponent(k.replace(/\+/g, " ")), decodeURIComponent(v.replace(/\+/g, " ")));
    } catch {
      map.set(k, v);
    }
  }
  return map;
}

function headToRequest(head: ParsedHead, body: Body): Request {
  return {
    method: head.requestLine.method as Method,
    path: head.path,
    query: head.query,
    params: new Map(),
    headers: head.headers,
    httpVersion: head.httpVersion,
    body,
    wantsKeepAlive: head.wantsKeepAlive,
  };
}

function isValidHeaderName(name: string): boolean {
  return /^[a-z0-9!#$%&'*+.^_`|~-]+$/i.test(name);
}

function isValidHeaderValue(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x7f || (c < 0x20 && c !== 0x09)) return false;
  }
  return true;
}

export function serializeResponse(response: Response): Buffer {
  const reason = STATUS_REASON[response.status] ?? "Unknown";
  const headers = new Map(response.headers);
  const body =
    response.body.kind === "none" ? Buffer.alloc(0) : Buffer.from(response.body.bytes);

  if (response.status !== 204) {
    headers.set("content-length", String(body.length));
  } else {
    headers.delete("content-length");
  }

  if (!headers.has("connection")) {
    headers.set(
      "connection",
      response.desire === "keep-alive" ? "keep-alive" : "close",
    );
  }

  if (!headers.has("date")) {
    headers.set("date", new Date().toUTCString());
  }

  if (!headers.has("server")) {
    headers.set("server", "http-from-scratch/1.0");
  }

  let head = `HTTP/1.1 ${response.status} ${reason}\r\n`;
  for (const [name, value] of headers) {
    head += `${name}: ${value}\r\n`;
  }
  head += "\r\n";
  return Buffer.concat([Buffer.from(head, "utf8"), body]);
}

/** Parse a complete HTTP request from a buffer (for tests). */
export function parseHttpRequest(
  raw: Buffer,
  limits: Limits,
): { ok: true; request: Request } | { ok: false; fault: ProtocolFault } {
  const fb = new FrameBuffer(limits);
  const result = fb.append(raw);
  if (result.kind === "request") return { ok: true, request: result.request };
  if (result.kind === "fault") return { ok: false, fault: result.fault };
  return {
    ok: false,
    fault: { code: "bad-request", detail: "incomplete", status: 400 },
  };
}

export function faultToResponse(fault: ProtocolFault): Response {
  const status = fault.status as StatusCode;
  const detail =
    "detail" in fault
      ? fault.detail
      : "method" in fault
        ? fault.method
        : "version" in fault
          ? fault.version
          : fault.code;
  const body = Buffer.from(`${STATUS_REASON[status] ?? "Error"}: ${detail}\n`, "utf8");
  return {
    status,
    headers: new Map([
      ["content-type", "text/plain; charset=utf-8"],
      ["content-length", String(body.length)],
      ["connection", "close"],
    ]),
    body: { kind: "bytes", bytes: new Uint8Array(body) },
    desire: "close",
  };
}
