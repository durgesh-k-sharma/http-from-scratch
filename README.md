# HTTP from scratch

A production-minded **HTTP/1.1 server** implemented on raw TCP (`node:net`) in TypeScript. It does **not** use Node's `http` module for serving. The goal is a clear, testable model of how HTTP actually works on the wire.

## Features

- Request-line, header, query, and `Content-Length` body parsing
- Methods: `GET`, `POST`, `PUT`, `DELETE`
- Path-param routing and query maps
- Response builders (`text`, `json`, `html`, empty/204)
- Static file serving with path-jail (traversal rejected)
- HTTP/1.1 persistent connections (keep-alive)
- Configurable host, port, and size/time limits
- Concurrent connections (one state machine per socket)
- Structured logging hooks
- Unit and integration tests plus a live verify script

## Quick start

```bash
npm install
npm test
npm start
# or: npx tsx examples/cli.ts --host 127.0.0.1 --port 8080
```

Then:

```bash
curl -i 'http://127.0.0.1:8080/api/hello?name=world'
curl -i -X POST http://127.0.0.1:8080/api/echo -H 'content-type: application/json' -d '{"a":1}'
curl -i http://127.0.0.1:8080/static/hello.txt
```

Live gate (starts the example, hits the real TCP port, exits):

```bash
npm run verify:live
```

## Library usage

```ts
import { createServer, json, text, bodyText } from "http-from-scratch";

const server = createServer({
  host: "127.0.0.1",
  port: 8080,
  publicDir: "./public",      // optional static fallback under /static
  limits: {
    maxHeaderBytes: 8192,
    maxBodyBytes: 1_048_576,
    maxUrlBytes: 2048,
    idleTimeoutMs: 5000,
    requestTimeoutMs: 30_000,
    maxRequestsPerConnection: 1000,
  },
});

server.get("/", () => text("ok"));
server.get("/users/:id", (req) => json({ id: req.params.get("id") }));
server.post("/echo", (req) => json({ body: bodyText(req.body) }));

await server.listen();
```

## How the HTTP implementation works

HTTP/1.1 is a text protocol over a byte stream. This server owns that stream explicitly.

```
TCP accept
  → Connection (per socket)
      → FrameBuffer: bytes → Request | fault
      → FrozenRouteTable.match → Handler → Response
      → serialize Response → bytes
      → keep-alive? IdleWait : close
```

### Connection state

Each socket is a sequential actor. While reading a request it accumulates bytes until headers (and optional body) are complete. After the handler returns, it writes one response. If both sides agree to keep-alive, it returns to an idle wait; otherwise it closes. Pipelined bytes that arrive during dispatch/write are rejected (v1 chooses simplicity over pipeline support).

### Parsing (boundary)

`src/frame.ts` is pure. It enforces URL/header/body size limits before allocating large structures, requires `Host` on HTTP/1.1, rejects `Transfer-Encoding: chunked` request bodies in v1, and maps faults to 4xx/5xx responses.

### Routing

`RouteRegistry` builds an immutable `FrozenRouteTable`. Patterns support `:param` segments. A miss with another method on the same path yields `405` with `Allow`. Optional `fallback` (used for static files) runs when no route matches.

### Static files

`staticFiles` resolves paths under a configured root with `path.normalize` + `realpath` checks so `..` and symlink escapes cannot leave the jail.

### What this is not

- Not TLS / HTTPS
- Not HTTP/2
- Not a full RFC-compliant proxy (absolute-form request targets are rejected)
- Not a chunked-request body decoder (Content-Length only)

## Project layout

| Path | Role |
|------|------|
| `src/server.ts` | `createServer` façade, `net.Server` accept loop |
| `src/connection.ts` | Per-socket actor, keep-alive, timers |
| `src/frame.ts` | Pure parse / serialize |
| `src/phase.ts` | Connection phase transitions (testable FSM) |
| `src/route-table.ts` | Registry + match + dispatch |
| `src/static.ts` | Root-jailed static handler |
| `src/reply.ts` | Response builders |
| `examples/cli.ts` | Demo app |
| `tests/` | Unit + TCP integration tests |
| `scripts/verify-live.ts` | End-to-end live predicate |

## Example requests

```http
GET /api/hello?name=Ada HTTP/1.1
Host: localhost
Connection: close

```

```http
POST /api/echo HTTP/1.1
Host: localhost
Content-Type: application/json
Content-Length: 9
Connection: close

{"x":42}
```

```http
PUT /api/items/1 HTTP/1.1
Host: localhost
Content-Length: 0
Connection: close

```

```http
DELETE /api/items/1 HTTP/1.1
Host: localhost
Connection: close

```

Keep-alive (two requests, one connection):

```bash
printf 'GET /api/hello HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\nGET /api/hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n' \
  | nc 127.0.0.1 8080
```

## Tests

```bash
npm test           # unit + integration
npm run typecheck
npm run verify:live
```

## Design notes

Architecture came from a three-way design arena. The base is a **connection-actor** with an explicit phase model and limits at the byte boundary. Grafted on top: a familiar `createServer` + verb API, discriminant `Body` / `MatchResult` types, and a frozen route registry with static fallback. Decision trail (local): `.audit/http-server.tsv`.

## License

MIT
