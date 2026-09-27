import type { Limits, Logger } from "./types.js";
import { DEFAULT_LIMITS } from "./types.js";

export type ServerOptions = {
  host?: string;
  port?: number;
  /** Directory for static fallback (optional). */
  publicDir?: string;
  /** URL prefix for static files when publicDir is set. Default "/static". */
  staticPrefix?: string;
  limits?: Partial<Limits>;
  logger?: Logger;
};

export type ServerConfig = {
  host: string;
  port: number;
  publicDir: string | undefined;
  staticPrefix: string;
  limits: Limits;
  logger: Logger;
};

export function parseConfig(options: ServerOptions = {}): ServerConfig {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8080;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid port: ${port}`);
  }
  if (host.length === 0) {
    throw new Error("host must be non-empty");
  }

  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits) as [keyof Limits, number][]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`invalid limit ${key}: ${value}`);
    }
  }

  return {
    host,
    port,
    publicDir: options.publicDir,
    staticPrefix: options.staticPrefix ?? "/static",
    limits,
    logger: options.logger ?? {
      info: (m, meta) => console.log(m, meta ?? ""),
      error: (m, meta) => console.error(m, meta ?? ""),
    },
  };
}
