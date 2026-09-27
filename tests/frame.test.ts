import { describe, expect, it } from "vitest";
import {
  parseHttpRequest,
  serializeResponse,
  DEFAULT_LIMITS,
} from "../src/testing.js";
import { json, ResponseBuilder } from "../src/reply.js";
import { bodyText } from "../src/types.js";

describe("parseHttpRequest", () => {
  it("parses GET with query", () => {
    const raw = Buffer.from(
      "GET /hello?name=nyx HTTP/1.1\r\nHost: localhost\r\n\r\n",
    );
    const result = parseHttpRequest(raw, DEFAULT_LIMITS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.method).toBe("GET");
    expect(result.request.path).toBe("/hello");
    expect(result.request.query.get("name")).toBe("nyx");
    expect(result.request.wantsKeepAlive).toBe(true);
  });

  it("parses POST body", () => {
    const body = '{"a":1}';
    const raw = Buffer.from(
      `POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${body.length}\r\nContent-Type: application/json\r\n\r\n${body}`,
    );
    const result = parseHttpRequest(raw, DEFAULT_LIMITS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.method).toBe("POST");
    expect(result.request.body.kind).toBe("bytes");
    if (result.request.body.kind === "bytes") {
      expect(bodyText(result.request.body)).toBe(body);
    }
  });

  it("rejects missing Host on HTTP/1.1", () => {
    const raw = Buffer.from("GET / HTTP/1.1\r\n\r\n");
    const result = parseHttpRequest(raw, DEFAULT_LIMITS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fault.code).toBe("bad-request");
  });

  it("rejects oversized URI", () => {
    const path = "/" + "a".repeat(3000);
    const raw = Buffer.from(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
    const result = parseHttpRequest(raw, DEFAULT_LIMITS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fault.code).toBe("uri-too-long");
  });

  it("rejects unsupported method", () => {
    const raw = Buffer.from("PATCH /x HTTP/1.1\r\nHost: localhost\r\n\r\n");
    const result = parseHttpRequest(raw, DEFAULT_LIMITS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fault.code).toBe("unsupported-method");
  });

  it("rejects chunked transfer-encoding", () => {
    const raw = Buffer.from(
      "POST /x HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n",
    );
    const result = parseHttpRequest(raw, DEFAULT_LIMITS);
    expect(result.ok).toBe(false);
  });
});

describe("serializeResponse", () => {
  it("emits status, headers, and body", () => {
    const wire = serializeResponse(json({ ok: true }));
    const textWire = wire.toString("utf8");
    expect(textWire.startsWith("HTTP/1.1 200 OK\r\n")).toBe(true);
    expect(textWire).toContain("content-type: application/json");
    expect(textWire).toContain('{"ok":true}');
  });

  it("omits body for 204", () => {
    const wire = serializeResponse(ResponseBuilder.empty(204));
    const s = wire.toString("utf8");
    expect(s.startsWith("HTTP/1.1 204")).toBe(true);
    expect(s.endsWith("\r\n\r\n")).toBe(true);
    expect(s.includes("content-length")).toBe(false);
  });
});
