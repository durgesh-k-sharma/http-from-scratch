import type { Handler, Method, Params, Request, Response } from "./types.js";
import { withParams } from "./types.js";
import { ResponseBuilder } from "./reply.js";

export type MatchResult =
  | { kind: "hit"; handler: Handler; params: Params }
  | { kind: "method_not_allowed"; allow: readonly Method[] }
  | { kind: "not_found" };

type RouteEntry = {
  method: Method;
  segments: Segment[];
  handler: Handler;
  pattern: string;
};

type Segment =
  | { kind: "lit"; value: string }
  | { kind: "param"; name: string }
  | { kind: "wildcard" };

export class RouteRegistry {
  private readonly entries: RouteEntry[] = [];
  private fallbackHandler: Handler | undefined;

  get(pattern: string, handler: Handler): this {
    return this.mount("GET", pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.mount("POST", pattern, handler);
  }

  put(pattern: string, handler: Handler): this {
    return this.mount("PUT", pattern, handler);
  }

  delete(pattern: string, handler: Handler): this {
    return this.mount("DELETE", pattern, handler);
  }

  mount(method: Method, pattern: string, handler: Handler): this {
    const key = `${method} ${pattern}`;
    if (this.entries.some((e) => `${e.method} ${e.pattern}` === key)) {
      throw new Error(`duplicate route: ${key}`);
    }
    this.entries.push({
      method,
      pattern,
      handler,
      segments: compilePattern(pattern),
    });
    return this;
  }

  fallback(handler: Handler): this {
    this.fallbackHandler = handler;
    return this;
  }

  build(): FrozenRouteTable {
    return new FrozenRouteTable(this.entries.slice(), this.fallbackHandler);
  }
}

export class FrozenRouteTable {
  constructor(
    private readonly entries: readonly RouteEntry[],
    private readonly fallbackHandler: Handler | undefined,
  ) {}

  match(req: Request): MatchResult {
    const pathSegs = splitPath(req.path);
    let allowed: Method[] = [];
    let pathMatched = false;

    for (const entry of this.entries) {
      const params = matchSegments(entry.segments, pathSegs);
      if (!params) continue;
      pathMatched = true;
      if (entry.method === req.method) {
        return { kind: "hit", handler: entry.handler, params };
      }
      allowed.push(entry.method);
    }

    if (pathMatched) {
      return {
        kind: "method_not_allowed",
        allow: [...new Set(allowed)],
      };
    }

    if (this.fallbackHandler) {
      return {
        kind: "hit",
        handler: this.fallbackHandler,
        params: new Map(),
      };
    }

    return { kind: "not_found" };
  }

  async dispatch(req: Request): Promise<Response> {
    const match = this.match(req);
    switch (match.kind) {
      case "hit":
        return match.handler(withParams(req, match.params));
      case "method_not_allowed":
        return ResponseBuilder.methodNotAllowed(match.allow);
      case "not_found":
        return ResponseBuilder.notFound();
    }
  }
}

function compilePattern(pattern: string): Segment[] {
  if (!pattern.startsWith("/")) {
    throw new Error(`pattern must start with /: ${pattern}`);
  }
  if (pattern === "/") return [];
  const parts = pattern.split("/").filter((p) => p.length > 0);
  return parts.map((part) => {
    if (part === "*") return { kind: "wildcard" as const };
    if (part.startsWith(":")) {
      return { kind: "param" as const, name: part.slice(1) };
    }
    return { kind: "lit" as const, value: part };
  });
}

function splitPath(path: string): string[] {
  if (path === "/") return [];
  return path.split("/").filter((p) => p.length > 0);
}

function matchSegments(
  pattern: Segment[],
  path: string[],
): Params | undefined {
  const params = new Map<string, string>();
  let pi = 0;
  let si = 0;

  while (pi < pattern.length) {
    const seg = pattern[pi];
    if (!seg) return undefined;

    if (seg.kind === "wildcard") {
      // Rest of path including empty.
      params.set("*", path.slice(si).join("/"));
      return params;
    }

    const part = path[si];
    if (part === undefined) return undefined;

    if (seg.kind === "lit") {
      if (seg.value !== part) return undefined;
    } else {
      params.set(seg.name, part);
    }
    pi += 1;
    si += 1;
  }

  if (si !== path.length) return undefined;
  return params;
}

export function createRequest(init: {
  method: Method;
  path: string;
  query?: Record<string, string>;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  httpVersion?: "1.0" | "1.1";
  body?: Uint8Array | string;
}): Request {
  const headers = new Map<string, string>();
  for (const [k, v] of Object.entries(init.headers ?? { host: "localhost" })) {
    headers.set(k.toLowerCase(), v);
  }
  if (!headers.has("host")) headers.set("host", "localhost");

  const query = new Map<string, string>(Object.entries(init.query ?? {}));
  const params = new Map<string, string>(Object.entries(init.params ?? {}));

  let body: Request["body"] = { kind: "none" };
  if (init.body !== undefined) {
    const bytes =
      typeof init.body === "string"
        ? new Uint8Array(Buffer.from(init.body, "utf8"))
        : init.body;
    body = { kind: "bytes", bytes };
  }

  const httpVersion = init.httpVersion ?? "1.1";
  return {
    method: init.method,
    path: init.path,
    query,
    params,
    headers,
    httpVersion,
    body,
    wantsKeepAlive: httpVersion === "1.1",
  };
}
