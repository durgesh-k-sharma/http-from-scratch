#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createServer,
  json,
  text,
  bodyText,
  bodyJson,
  notFound,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const host = arg("host", "127.0.0.1")!;
const port = Number(arg("port", "8080"));
const root = arg("public", publicDir)!;

const server = createServer({
  host,
  port,
  publicDir: root,
  staticPrefix: "/static",
  logger: {
    info: (msg, meta) => console.log(`[info] ${msg}`, meta ?? ""),
    error: (msg, meta) => console.error(`[error] ${msg}`, meta ?? ""),
  },
});

server.get("/", () =>
  text(
    [
      "http-from-scratch",
      "",
      "Try:",
      "  GET  /api/hello?name=world",
      "  GET  /api/users/:id",
      "  POST /api/echo  (JSON body)",
      "  PUT  /api/items/:id",
      "  DELETE /api/items/:id",
      "  GET  /static/  (static files)",
      "",
    ].join("\n"),
  ),
);

server.get("/api/hello", (req) => {
  const name = req.query.get("name") ?? "world";
  return json({ message: `hello, ${name}` });
});

server.get("/api/users/:id", (req) => {
  const id = req.params.get("id");
  return json({ id, name: `user-${id}` });
});

server.post("/api/echo", (req) => {
  if (req.body.kind === "none") {
    return json({ error: "body required" }, 400);
  }
  try {
    return json({
      bytes: req.body.bytes.byteLength,
      text: bodyText(req.body),
      json: bodyJson(req.body),
    });
  } catch {
    return json({
      bytes: req.body.bytes.byteLength,
      text: bodyText(req.body),
    });
  }
});

server.put("/api/items/:id", (req) =>
  json({ updated: req.params.get("id"), body: bodyText(req.body) }),
);

server.delete("/api/items/:id", (req) =>
  json({ deleted: req.params.get("id") }),
);

server.get("/api/missing", () => notFound("nope"));

const { port: bound } = await server.listen();
console.log(`Listening on http://${host}:${bound}`);
console.log(`Static files from ${root} at /static/`);

const shutdown = async () => {
  console.log("Shutting down...");
  await server.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
