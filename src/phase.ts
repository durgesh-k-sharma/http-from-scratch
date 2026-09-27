import type { CloseReason, ProtocolFault, Request, Response } from "./types.js";

export type RequestLine = {
  readonly method: string;
  readonly target: string;
  readonly version: string;
};

export type ParsedHead = {
  readonly requestLine: RequestLine;
  readonly headers: Map<string, string>;
  readonly contentLength: number;
  readonly wantsKeepAlive: boolean;
  readonly httpVersion: "1.0" | "1.1";
  readonly path: string;
  readonly query: Map<string, string>;
};

/** Connection actor phase. Illegal combinations are unrepresentable. */
export type Phase =
  | { kind: "AwaitRequestLine" }
  | { kind: "AwaitHeaders"; requestLine: RequestLine; headBytes: number }
  | { kind: "AwaitBody"; head: ParsedHead; remaining: number; parts: Uint8Array[] }
  | { kind: "Dispatch"; request: Request }
  | { kind: "Write"; response: Response; keepAlive: boolean }
  | { kind: "IdleWait" }
  | { kind: "Drain"; reason: CloseReason }
  | { kind: "Closed"; reason: CloseReason };

export type PhaseEvent =
  | { type: "bytes"; chunk: Uint8Array }
  | { type: "head-ready"; head: ParsedHead }
  | { type: "body-ready"; request: Request }
  | { type: "handler-done"; response: Response; keepAlive: boolean }
  | { type: "write-done"; keepAlive: boolean }
  | { type: "idle-timeout" }
  | { type: "request-timeout" }
  | { type: "peer-close" }
  | { type: "fault"; fault: ProtocolFault }
  | { type: "max-requests" }
  | { type: "drain-requested" }
  | { type: "abort" };

export type TransitionResult =
  | { ok: true; phase: Phase }
  | { ok: false; phase: Phase; fault?: ProtocolFault };

export function initialPhase(): Phase {
  return { kind: "AwaitRequestLine" };
}

export function transition(phase: Phase, event: PhaseEvent): TransitionResult {
  if (event.type === "abort") {
    return { ok: true, phase: { kind: "Closed", reason: "abort" } };
  }
  if (event.type === "drain-requested") {
    if (phase.kind === "Closed") return { ok: true, phase };
    return { ok: true, phase: { kind: "Drain", reason: "server-drain" } };
  }
  if (event.type === "peer-close") {
    return { ok: true, phase: { kind: "Closed", reason: "client-close" } };
  }

  switch (phase.kind) {
    case "AwaitRequestLine":
    case "AwaitHeaders":
    case "AwaitBody":
      if (event.type === "request-timeout") {
        return {
          ok: false,
          phase: { kind: "Drain", reason: "request-timeout" },
          fault: { code: "timeout", status: 408 },
        };
      }
      if (event.type === "fault") {
        return {
          ok: false,
          phase: { kind: "Drain", reason: "protocol-error" },
          fault: event.fault,
        };
      }
      if (event.type === "head-ready") {
        if (event.head.contentLength === 0) {
          return {
            ok: true,
            phase: {
              kind: "Dispatch",
              request: headToRequest(event.head, { kind: "none" }),
            },
          };
        }
        return {
          ok: true,
          phase: {
            kind: "AwaitBody",
            head: event.head,
            remaining: event.head.contentLength,
            parts: [],
          },
        };
      }
      if (event.type === "body-ready") {
        return { ok: true, phase: { kind: "Dispatch", request: event.request } };
      }
      if (event.type === "bytes") {
        return { ok: true, phase };
      }
      break;

    case "Dispatch":
      if (event.type === "handler-done") {
        return {
          ok: true,
          phase: {
            kind: "Write",
            response: event.response,
            keepAlive: event.keepAlive,
          },
        };
      }
      if (event.type === "fault") {
        return {
          ok: false,
          phase: { kind: "Drain", reason: "protocol-error" },
          fault: event.fault,
        };
      }
      break;

    case "Write":
      if (event.type === "write-done") {
        if (event.keepAlive) {
          return { ok: true, phase: { kind: "IdleWait" } };
        }
        return { ok: true, phase: { kind: "Drain", reason: "client-close" } };
      }
      break;

    case "IdleWait":
      if (event.type === "idle-timeout") {
        return { ok: true, phase: { kind: "Closed", reason: "idle-timeout" } };
      }
      if (event.type === "max-requests") {
        return { ok: true, phase: { kind: "Closed", reason: "max-requests" } };
      }
      if (event.type === "bytes") {
        return { ok: true, phase: { kind: "AwaitRequestLine" } };
      }
      break;

    case "Drain":
      return { ok: true, phase: { kind: "Closed", reason: phase.reason } };

    case "Closed":
      return { ok: true, phase };
  }

  return { ok: true, phase };
}

function headToRequest(
  head: ParsedHead,
  body: Request["body"],
): Request {
  const method = head.requestLine.method as Request["method"];
  return {
    method,
    path: head.path,
    query: head.query,
    params: new Map(),
    headers: head.headers,
    httpVersion: head.httpVersion,
    body,
    wantsKeepAlive: head.wantsKeepAlive,
  };
}
