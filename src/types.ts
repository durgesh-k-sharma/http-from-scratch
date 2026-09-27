/** Shared domain types for the HTTP/1.1 server. */

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export type StatusCode =
  | 200
  | 201
  | 204
  | 400
  | 403
  | 404
  | 405
  | 408
  | 411
  | 413
  | 414
  | 431
  | 500
  | 501
  | 505;

export type ConnectionDesire = "keep-alive" | "close";

export type CloseReason =
  | "client-close"
  | "idle-timeout"
  | "request-timeout"
  | "protocol-error"
  | "server-drain"
  | "max-requests"
  | "abort";

export type Body =
  | { readonly kind: "none" }
  | { readonly kind: "bytes"; readonly bytes: Uint8Array };

export type HeaderMap = Map<string, string>;

export type Query = ReadonlyMap<string, string>;
export type Params = ReadonlyMap<string, string>;

export interface Request {
  readonly method: Method;
  /** Pathname only (no query), percent-decoded. */
  readonly path: string;
  readonly query: Query;
  readonly params: Params;
  readonly headers: ReadonlyMap<string, string>;
  readonly httpVersion: "1.0" | "1.1";
  readonly body: Body;
  readonly wantsKeepAlive: boolean;
}

export interface Response {
  readonly status: StatusCode;
  readonly headers: ReadonlyMap<string, string>;
  readonly body: Body;
  readonly desire: ConnectionDesire;
}

export type Handler = (req: Request) => Response | Promise<Response>;

export interface Limits {
  readonly maxHeaderBytes: number;
  readonly maxBodyBytes: number;
  readonly maxUrlBytes: number;
  readonly idleTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly maxRequestsPerConnection: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxHeaderBytes: 8_192,
  maxBodyBytes: 1_048_576,
  maxUrlBytes: 2_048,
  idleTimeoutMs: 5_000,
  requestTimeoutMs: 30_000,
  maxRequestsPerConnection: 1_000,
};

export type ProtocolFault =
  | { code: "bad-request"; detail: string; status: StatusCode }
  | { code: "uri-too-long"; status: 414 }
  | { code: "headers-too-large"; status: 431 }
  | { code: "body-too-large"; status: 413 }
  | { code: "length-required"; status: 411 }
  | { code: "unsupported-method"; method: string; status: 501 }
  | { code: "unsupported-version"; version: string; status: 505 }
  | { code: "timeout"; status: 408 }
  | { code: "pipeline-rejected"; status: 400 };

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const silentLogger: Logger = {
  info() {},
  error() {},
};

export const STATUS_REASON: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  411: "Length Required",
  413: "Payload Too Large",
  414: "URI Too Long",
  431: "Request Header Fields Too Large",
  500: "Internal Server Error",
  501: "Not Implemented",
  505: "HTTP Version Not Supported",
};

export function headerGet(
  headers: ReadonlyMap<string, string>,
  name: string,
): string | undefined {
  return headers.get(name.toLowerCase());
}

export function headersFromRecord(
  init?: Record<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!init) return map;
  for (const [k, v] of Object.entries(init)) {
    map.set(k.toLowerCase(), v);
  }
  return map;
}

export function withParams(req: Request, params: Params): Request {
  return { ...req, params };
}

export function bodyText(body: Body, encoding: BufferEncoding = "utf8"): string {
  if (body.kind === "none") return "";
  return Buffer.from(body.bytes).toString(encoding);
}

export function bodyJson<T = unknown>(body: Body): T {
  const text = bodyText(body);
  if (text === "") {
    throw new SyntaxError("empty body");
  }
  return JSON.parse(text) as T;
}
