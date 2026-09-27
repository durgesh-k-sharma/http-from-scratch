# Arena cross-judge verdict

Rubric: (1) deep public surface hiding parse/serialize/conn (2) domain types not wire buffers on API (3) connection lifecycle as explicit state machine (4) security limits at boundaries (5) testable pure core (6) fits Node net without node:http  
Scale: 0–2 per criterion.

---

## Candidate 1 — classic deep Server + Router

| # | Score | Justification |
|---|-------|---------------|
| 1 | 2 | `createServer` + verb sugar + builders is a deep façade; parse/serialize stay under `/testing` and connection is not an app-facing API. |
| 2 | 1 | Handlers see `Request`/`Response`, but body is a raw `Buffer` and the types sketch still surfaces wire-adjacent `buf: Buffer` on `ConnectionState`. |
| 3 | 2 | Discriminated `ConnectionState` (`read-head` → `read-body` → `dispatch` → `write` → close) owns keep-alive with no parallel boolean flags. |
| 4 | 1 | Header/body/max-requests/keep-alive limits and static jail sit at parse/config boundaries, but URL-length and headers-read timeouts are missing (noted as open risk). |
| 5 | 2 | `Router.handle` + `createRequest` plus pure `parseHttpRequest`/`serializeResponse` fixtures give a socket-free core. |
| 6 | 2 | Accept loop is `node:net` only; no `node:http` dependency or shapes. |

**Total: 10 / 12**

---

## Candidate 2 — connection-actor first

| # | Score | Justification |
|---|-------|---------------|
| 1 | 2 | App surface is `ConnectionServer.bind` + `RouteTable` + `reply`/`staticTarget`; framing, write lock, and jail stay behind the actor. |
| 2 | 2 | Callers work in `InboundMessage`/`OutboundMessage`/`Body`; `FrameBuffer` and decode progress are internal (or `/testing` only). |
| 3 | 2 | `Phase` sum + pure `transition(phase, event)` is the load-bearing model; keep-alive/`IdleWait`/`Drain`/`Closed` are first-class. |
| 4 | 2 | Header/body/URL byte caps and idle timeout are enforced in the frame buffer before growth; jail + Host/method checks at boundaries. |
| 5 | 2 | Pure `decodeAppend`/`encodeOutbound`/`transition`/`lookup` plus `MemorySocket` + `dispatchMessage` cover unit and actor tests without ports. |
| 6 | 2 | `SocketPort` adapts `node:net.Socket`; listener is thin TCP acquire with no `node:http`. |

**Total: 12 / 12**

---

## Candidate 3 — typed route registry + immutable VOs

| # | Score | Justification |
|---|-------|---------------|
| 1 | 2 | `RouteRegistry` + `createServer` + factories hide parser, serializer, and socket adapter from the happy path. |
| 2 | 2 | Immutable `Request`/`Response`, branded `Pathname`, and exhaustive `Body`/`MatchResult` keep wire buffers out of the handler API. |
| 3 | 0 | Keep-alive is a thin adapter loop by design; there is no `Phase`/`ConnectionState` union—lifecycle stays implicit. |
| 4 | 2 | Richest `Limits` (URI/header/body + request & keep-alive timeouts + max-requests) applied at protocol/config/static/net edges with path jail. |
| 5 | 2 | Pure parse/serialize, registry `match`, and `Request` factories allow full handler/routing tests without sockets. |
| 6 | 2 | `net/adapter` + `net/server` on raw TCP; explicitly no `node:http`. |

**Total: 10 / 12**

---

## Recommendation

**Base: Candidate 2 (connection-actor first).**

It is the only package that maxes the rubric: connection lifecycle is an explicit, testable state machine (criterion 3), domain messages stay free of wire buffers, limits are enforced at the byte boundary (including URL size), and `MemorySocket` makes the actor itself unit-testable—while still presenting a deep bind + route-table surface over raw `node:net`.

Candidates 1 and 3 tie at 10. C1 is the best README/DX shape but weaker on domain byte wrapping and limit completeness. C3 has the strongest immutable routing/VO story and the fullest limits object, but fails criterion 3 by treating connection lifecycle as an untyped adapter loop.

### Grafts from losers (into C2)

1. **From C1 — classic verb-sugar façade:** expose `createServer(...).get/post/put/delete` (or thin wrappers over `RouteTable.mount`) so the README matches the deep Server ergonomics apps expect.
2. **From C3 — immutable `Body` + exhaustive `MatchResult`:** replace optional/raw body bytes with `{ kind: 'none' } | { kind: 'bytes' }` and `hit | method_not_allowed | not_found` so 405/`Allow` is typed, not ad-hoc.
3. **From C3 — complete Limits set:** add `requestTimeoutMs` (headers/body read) and `maxRequestsPerConnection` alongside C2’s `maxUrlBytes` + idle timeout.
4. **From C3 — `RouteRegistry.build()` → frozen table + `fallback(staticFiles)`:** keep C2’s immutable mounts, but adopt an explicit freeze step and static-as-handler fallback so static is not a parallel server mode.

### Scores summary

| Candidate | 1 | 2 | 3 | 4 | 5 | 6 | Total |
|-----------|---|---|---|---|---|---|-------|
| 1 Server+Router | 2 | 1 | 2 | 1 | 2 | 2 | **10** |
| 2 Connection-actor | 2 | 2 | 2 | 2 | 2 | 2 | **12** |
| 3 Route registry+VOs | 2 | 2 | 0 | 2 | 2 | 2 | **10** |
