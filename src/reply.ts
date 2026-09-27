import type {
  ConnectionDesire,
  Response,
  StatusCode,
} from "./types.js";
import { headersFromRecord } from "./types.js";

function build(
  status: StatusCode,
  body: Response["body"],
  headers?: Record<string, string>,
  desire: ConnectionDesire = "keep-alive",
): Response {
  const map = headersFromRecord(headers);
  return { status, headers: map, body, desire };
}

export const ResponseBuilder = {
  text(
    status: StatusCode,
    text: string,
    headers?: Record<string, string>,
    desire?: ConnectionDesire,
  ): Response {
    const bytes = Buffer.from(text, "utf8");
    const h = { "content-type": "text/plain; charset=utf-8", ...headers };
    return build(status, { kind: "bytes", bytes: new Uint8Array(bytes) }, h, desire);
  },

  json(
    status: StatusCode,
    value: unknown,
    headers?: Record<string, string>,
    desire?: ConnectionDesire,
  ): Response {
    const bytes = Buffer.from(JSON.stringify(value), "utf8");
    const h = { "content-type": "application/json; charset=utf-8", ...headers };
    return build(status, { kind: "bytes", bytes: new Uint8Array(bytes) }, h, desire);
  },

  html(
    status: StatusCode,
    html: string,
    headers?: Record<string, string>,
    desire?: ConnectionDesire,
  ): Response {
    const bytes = Buffer.from(html, "utf8");
    const h = { "content-type": "text/html; charset=utf-8", ...headers };
    return build(status, { kind: "bytes", bytes: new Uint8Array(bytes) }, h, desire);
  },

  bytes(
    status: StatusCode,
    bytes: Uint8Array,
    contentType = "application/octet-stream",
    headers?: Record<string, string>,
    desire?: ConnectionDesire,
  ): Response {
    const h = { "content-type": contentType, ...headers };
    return build(status, { kind: "bytes", bytes }, h, desire);
  },

  empty(status: StatusCode = 204, desire?: ConnectionDesire): Response {
    return build(status, { kind: "none" }, undefined, desire);
  },

  notFound(message = "Not Found"): Response {
    return ResponseBuilder.text(404, message);
  },

  methodNotAllowed(allow: readonly string[]): Response {
    return ResponseBuilder.text(405, "Method Not Allowed", {
      allow: allow.join(", "),
    });
  },
};

/** Shorthand aliases matching common call sites. */
export const reply = ResponseBuilder;

export function text(body: string, status: StatusCode = 200): Response {
  return ResponseBuilder.text(status, body);
}

export function json(value: unknown, status: StatusCode = 200): Response {
  return ResponseBuilder.json(status, value);
}

export function html(body: string, status: StatusCode = 200): Response {
  return ResponseBuilder.html(status, body);
}

export function notFound(message?: string): Response {
  return ResponseBuilder.notFound(message);
}

export function noContent(): Response {
  return ResponseBuilder.empty(204);
}
