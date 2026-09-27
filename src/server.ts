import net from "node:net";
import type { Handler, Method, Response } from "./types.js";
import { parseConfig, type ServerOptions } from "./config.js";
import { RouteRegistry, type FrozenRouteTable } from "./route-table.js";
import { Connection } from "./connection.js";
import { staticFiles } from "./static.js";
import { silentLogger } from "./types.js";

export class Server {
  private readonly config: ReturnType<typeof parseConfig>;
  private readonly registry: RouteRegistry;
  private table: FrozenRouteTable | undefined;
  private netServer: net.Server | undefined;
  private listening = false;

  constructor(options: ServerOptions = {}) {
    this.config = parseConfig(options);
    this.registry = new RouteRegistry();
  }

  get(pattern: string, handler: Handler): this {
    this.registry.get(pattern, handler);
    return this;
  }

  post(pattern: string, handler: Handler): this {
    this.registry.post(pattern, handler);
    return this;
  }

  put(pattern: string, handler: Handler): this {
    this.registry.put(pattern, handler);
    return this;
  }

  delete(pattern: string, handler: Handler): this {
    this.registry.delete(pattern, handler);
    return this;
  }

  route(method: Method, pattern: string, handler: Handler): this {
    this.registry.mount(method, pattern, handler);
    return this;
  }

  fallback(handler: Handler): this {
    this.registry.fallback(handler);
    return this;
  }

  /** Freeze routes and bind TCP. */
  async listen(): Promise<{ host: string; port: number }> {
    if (this.listening) {
      throw new Error("server already listening");
    }

    if (this.config.publicDir) {
      this.registry.fallback(
        staticFiles({
          root: this.config.publicDir,
          prefix: this.config.staticPrefix,
        }),
      );
    }

    this.table = this.registry.build();
    const table = this.table;
    const { limits, logger, host, port } = this.config;

    const server = net.createServer((socket) => {
      const remoteLabel = `${socket.remoteAddress ?? "?"}:${socket.remotePort ?? "?"}`;
      new Connection({
        socket,
        routes: table,
        limits,
        logger,
        remoteLabel,
      });
    });

    this.netServer = server;

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    this.listening = true;
    const address = server.address();
    const boundPort =
      typeof address === "object" && address ? address.port : port;

    logger.info("listening", { host, port: boundPort });
    return { host, port: boundPort };
  }

  async close(): Promise<void> {
    const server = this.netServer;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    this.listening = false;
    this.netServer = undefined;
  }

  get isListening(): boolean {
    return this.listening;
  }

  /** For tests that supply a pre-built table. */
  static async listenWithTable(
    table: FrozenRouteTable,
    options: ServerOptions = {},
  ): Promise<{ server: net.Server; host: string; port: number; close: () => Promise<void> }> {
    const config = parseConfig({ ...options, logger: options.logger ?? silentLogger });
    const server = net.createServer((socket) => {
      const remoteLabel = `${socket.remoteAddress ?? "?"}:${socket.remotePort ?? "?"}`;
      new Connection({
        socket,
        routes: table,
        limits: config.limits,
        logger: config.logger,
        remoteLabel,
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = server.address();
    const boundPort =
      typeof address === "object" && address ? address.port : config.port;

    return {
      server,
      host: config.host,
      port: boundPort,
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    };
  }
}

export function createServer(options?: ServerOptions): Server {
  return new Server(options);
}

export type { Response };
