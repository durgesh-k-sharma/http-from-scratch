# Synthesized design

## Synthesis decision

**Base:** candidate-2 (connection-actor). Cross-judge scored 12/12. Parent agrees: explicit `Phase` FSM, limits at the byte boundary, and `MemorySocket`-testable connection are the load-bearing wins for an HTTP/1.1-from-scratch server.

**Grafts:**
- From C1: `createServer().get/post/put/delete` façade and familiar `Request`/`Response` names on the public surface (wrappers over inbound/outbound messages).
- From C3: `Body` as `{ kind: 'none' } | { kind: 'bytes' }`; exhaustive `MatchResult` (`hit` | `method_not_allowed` | `not_found`); fuller `Limits` (`requestTimeoutMs`, `maxRequestsPerConnection`, `maxUrlBytes`); `RouteRegistry.build()` → frozen table + `fallback(staticFiles)`.

**Rejected without graft:** C2’s public `InboundMessage`/`ConnectionServer.bind` naming (kept as internal concepts); C3’s thin adapter-only lifecycle (criterion 3 failure); Express middleware.

## Public surface

`createServer`, verb mounts, `Response`/`reply` builders, `staticFiles`, `listen`/`close`, config/limits/logger. Testing export: parse/serialize, `dispatch`, phase transition, in-memory socket driver.

## Module map

`phase`, `frame` (parse/serialize), `route-table`, `connection`, `server`, `reply`, `static`, `config`, `errors`, `log`, `index`, `testing`.

## Next step

Scaffold package + implement `phase` and `frame` with wire-byte fixtures, then router, connection, server, static, examples, README, live verify script.
