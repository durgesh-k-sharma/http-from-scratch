import fs from "node:fs/promises";
import path from "node:path";
import type { Handler, Request, Response } from "./types.js";
import { ResponseBuilder } from "./reply.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export type StaticOptions = {
  root: string;
  /** URL prefix stripped before join; default "". Use "/static" to mount under /static. */
  prefix?: string;
  index?: string;
};

/**
 * Resolve a user path under root. Returns absolute path or null on traversal.
 */
export async function resolveInJail(
  root: string,
  urlPath: string,
): Promise<string | null> {
  const rootReal = await fs.realpath(root).catch(() => null);
  if (!rootReal) return null;

  if (urlPath.includes("\0") || urlPath.includes("\\")) return null;

  // Strip leading slashes; join + normalize so ".." cannot escape the root.
  const relative = urlPath.replace(/^\/+/, "");
  const joined = path.normalize(path.join(rootReal, relative));

  if (joined !== rootReal && !joined.startsWith(rootReal + path.sep)) {
    return null;
  }

  try {
    const real = await fs.realpath(joined);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
      return null;
    }
    return real;
  } catch {
    // Missing file: still return the jailed path for the caller to 404.
    return joined;
  }
}

export function staticFiles(options: StaticOptions): Handler {
  const root = path.resolve(options.root);
  const prefix = options.prefix ?? "";
  const index = options.index ?? "index.html";

  return async (req: Request): Promise<Response> => {
    if (req.method !== "GET") {
      return ResponseBuilder.methodNotAllowed(["GET"]);
    }

    let urlPath = req.path;
    if (prefix) {
      if (urlPath === prefix) {
        urlPath = "/";
      } else if (urlPath.startsWith(prefix + "/")) {
        urlPath = urlPath.slice(prefix.length) || "/";
      } else {
        return ResponseBuilder.notFound();
      }
    }

    let candidate = await resolveInJail(root, urlPath);
    if (!candidate) {
      return ResponseBuilder.text(403, "Forbidden");
    }

    let stat = await fs.stat(candidate).catch(() => null);
    if (stat?.isDirectory()) {
      const indexed = await resolveInJail(
        root,
        path.posix.join(urlPath === "/" ? "/" : urlPath, index),
      );
      if (!indexed) return ResponseBuilder.text(403, "Forbidden");
      candidate = indexed;
      stat = await fs.stat(candidate).catch(() => null);
    }

    if (!stat || !stat.isFile()) {
      return ResponseBuilder.notFound();
    }

    const data = await fs.readFile(candidate);
    const ext = path.extname(candidate).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    return ResponseBuilder.bytes(200, new Uint8Array(data), type);
  };
}
