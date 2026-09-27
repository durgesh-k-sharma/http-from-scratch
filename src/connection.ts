import type { Socket } from "node:net";
import type { Limits, Logger, Request, Response } from "./types.js";
import { FrameBuffer, faultToResponse, serializeResponse } from "./frame.js";
import type { FrozenRouteTable } from "./route-table.js";
import type { ProtocolFault } from "./types.js";

type ConnState = "reading" | "dispatching" | "writing" | "idle" | "closed";

export type ConnectionOptions = {
  socket: Socket;
  routes: FrozenRouteTable;
  limits: Limits;
  logger: Logger;
  remoteLabel: string;
};

/**
 * Per-socket connection actor.
 * Sequential request handling with keep-alive; rejects pipelining while busy.
 */
export class Connection {
  private state: ConnState = "reading";
  private readonly frame: FrameBuffer;
  private requestCount = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  private requestTimer: NodeJS.Timeout | undefined;
  private closed = false;
  private pumpActive = false;
  private pending: Buffer[] = [];

  constructor(private readonly opts: ConnectionOptions) {
    this.frame = new FrameBuffer(opts.limits);
    const { socket } = opts;
    socket.on("data", (chunk) => {
      void this.onData(chunk);
    });
    socket.on("close", () => this.close());
    socket.on("error", (err) => {
      opts.logger.error("socket error", {
        remote: opts.remoteLabel,
        err: String(err),
      });
      this.close();
    });
    this.armRequestTimer();
  }

  private async onData(chunk: Buffer): Promise<void> {
    if (this.closed) return;

    if (this.state === "dispatching" || this.state === "writing") {
      await this.sendFaultAndClose({
        code: "pipeline-rejected",
        status: 400,
      });
      return;
    }

    if (this.state === "idle") {
      this.clearIdleTimer();
      this.state = "reading";
      this.armRequestTimer();
    }

    this.pending.push(chunk);
    if (this.pumpActive) return;
    this.pumpActive = true;
    try {
      while (this.pending.length > 0 && !this.closed) {
        const next = this.pending.shift();
        if (!next) break;
        await this.consumeChunk(next);
      }
    } finally {
      this.pumpActive = false;
    }
  }

  private async consumeChunk(chunk: Buffer): Promise<void> {
    const result = this.frame.append(chunk);

    if (result.kind === "need-more") return;

    if (result.kind === "fault") {
      this.clearRequestTimer();
      this.opts.logger.info("protocol fault", {
        remote: this.opts.remoteLabel,
        code: result.fault.code,
      });
      await this.sendFaultAndClose(result.fault);
      return;
    }

    if (result.kind === "request") {
      this.clearRequestTimer();
      this.requestCount += 1;

      if (this.requestCount > this.opts.limits.maxRequestsPerConnection) {
        await this.sendFaultAndClose({ code: "timeout", status: 408 });
        return;
      }

      this.state = "dispatching";
      await this.handleRequest(result.request);
      if (this.closed) return;

      const left = this.frame.leftover();
      if (left.length > 0) {
        this.frame.dropLeftover();
        this.pending.unshift(Buffer.from(left));
        this.clearIdleTimer();
        this.state = "reading";
        this.armRequestTimer();
      }
    }
  }

  private async handleRequest(request: Request): Promise<void> {
    const start = Date.now();
    let response: Response;
    try {
      response = await this.opts.routes.dispatch(request);
    } catch (err) {
      this.opts.logger.error("handler error", {
        remote: this.opts.remoteLabel,
        err: String(err),
      });
      response = {
        status: 500,
        headers: new Map([["content-type", "text/plain; charset=utf-8"]]),
        body: {
          kind: "bytes",
          bytes: new Uint8Array(Buffer.from("Internal Server Error\n")),
        },
        desire: "close",
      };
    }

    const keepAlive =
      request.wantsKeepAlive &&
      response.desire !== "close" &&
      this.requestCount < this.opts.limits.maxRequestsPerConnection;

    const headers = new Map(response.headers);
    headers.set("connection", keepAlive ? "keep-alive" : "close");

    const finalResponse: Response = {
      status: response.status,
      headers,
      body: response.body,
      desire: keepAlive ? "keep-alive" : "close",
    };

    this.state = "writing";
    try {
      const bytes = serializeResponse(finalResponse);
      await writeAll(this.opts.socket, bytes);
    } catch (err) {
      this.opts.logger.error("write failed", {
        remote: this.opts.remoteLabel,
        err: String(err),
      });
      this.close();
      return;
    }

    this.opts.logger.info("request", {
      remote: this.opts.remoteLabel,
      method: request.method,
      path: request.path,
      status: finalResponse.status,
      ms: Date.now() - start,
      keepAlive,
    });

    if (keepAlive) {
      this.frame.resetForNextRequest();
      this.state = "idle";
      this.armIdleTimer();
    } else {
      this.close();
    }
  }

  private async sendFaultAndClose(fault: ProtocolFault): Promise<void> {
    if (this.closed) return;
    this.state = "writing";
    try {
      const bytes = serializeResponse(faultToResponse(fault));
      await writeAll(this.opts.socket, bytes);
    } catch {
      /* peer may already be gone */
    }
    this.close();
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.close(), this.opts.limits.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private armRequestTimer(): void {
    this.clearRequestTimer();
    this.requestTimer = setTimeout(() => {
      void this.onRequestTimeout();
    }, this.opts.limits.requestTimeoutMs);
  }

  private clearRequestTimer(): void {
    if (this.requestTimer) {
      clearTimeout(this.requestTimer);
      this.requestTimer = undefined;
    }
  }

  private async onRequestTimeout(): Promise<void> {
    if (this.closed) return;
    if (this.state === "reading") {
      await this.sendFaultAndClose({ code: "timeout", status: 408 });
    }
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.state = "closed";
    this.clearIdleTimer();
    this.clearRequestTimer();
    const socket = this.opts.socket;
    if (!socket.destroyed) {
      socket.destroy();
    }
  }

  abort(): void {
    this.close();
  }
}

function writeAll(socket: Socket, bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(bytes, (err) => (err ? reject(err) : resolve()));
  });
}
