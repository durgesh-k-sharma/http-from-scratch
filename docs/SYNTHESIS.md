# Synthesized design

## Synthesis decision

**Base:** candidate-2 (connection-actor). Cross-judge scored 12/12. Parent agrees: explicit `Phase` FSM, limits at the byte boundary, and a testable connection actor are the load-bearing wins. Verdict checked into `docs/arena-cross-judge.md`.

**Grafts (implemented, not re-judged as a fourth sketch):**
- From C1: `createServer().get/post/put/delete` façade and familiar `Request`/`Response` names.
- From C3: `Body` discriminant; exhaustive `MatchResult`; fuller `Limits`; `RouteRegistry.build()` + `fallback(staticFiles)`.

**Rejected without graft:** C2’s public `InboundMessage`/`ConnectionServer.bind` naming; C3’s thin adapter-only lifecycle; Express middleware.

**Arena note:** Named models were unavailable on this plan. All three seats ran on Auto with prompt-forced structural diversity (classic Server, connection-actor, route-registry). Treat the arena as structural fan-out, not independent-model disagreement.

## Public surface

`createServer`, verb mounts, response builders, `staticFiles`, `listen`/`close`, config/limits/logger. Testing export: parse/serialize, phase transition, router helpers.

## Module map

`phase`, `frame`, `route-table`, `connection`, `server`, `reply`, `static`, `config`, `types`, `index`, `testing`.

## Status

Shipped. Predicate verified: `npm test` (29/29), `npm run typecheck`, `npm run verify:live` (GET/POST/PUT/DELETE, static, keep-alive), no `node:http` imports under `src/`, `examples/`, `scripts/`. Repo: https://github.com/durgesh-k-sharma/http-from-scratch

## Deliberate v1 gaps

Pipelined requests rejected while busy. Chunked request bodies rejected. Absolute-form request-targets rejected. No TLS or HTTP/2.
