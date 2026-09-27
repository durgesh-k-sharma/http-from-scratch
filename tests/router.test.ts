import { describe, expect, it } from "vitest";
import { RouteRegistry, createRequest } from "../src/route-table.js";
import { json, text } from "../src/reply.js";

describe("RouteRegistry", () => {
  it("matches path params", async () => {
    const table = new RouteRegistry()
      .get("/users/:id", (req) => json({ id: req.params.get("id") }))
      .build();

    const req = createRequest({ method: "GET", path: "/users/42" });
    const res = await table.dispatch(req);
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("bytes");
    if (res.body.kind === "bytes") {
      expect(Buffer.from(res.body.bytes).toString()).toBe('{"id":"42"}');
    }
  });

  it("returns 405 with Allow", async () => {
    const table = new RouteRegistry()
      .get("/only-get", () => text("ok"))
      .build();
    const req = createRequest({ method: "POST", path: "/only-get" });
    const res = await table.dispatch(req);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  it("returns 404 for unknown paths", async () => {
    const table = new RouteRegistry().get("/", () => text("home")).build();
    const req = createRequest({ method: "GET", path: "/nope" });
    const res = await table.dispatch(req);
    expect(res.status).toBe(404);
  });

  it("uses fallback handler", async () => {
    const table = new RouteRegistry()
      .fallback(() => text("fb"))
      .build();
    const req = createRequest({ method: "GET", path: "/anything" });
    const res = await table.dispatch(req);
    expect(res.status).toBe(200);
    if (res.body.kind === "bytes") {
      expect(Buffer.from(res.body.bytes).toString()).toBe("fb");
    }
  });

  it("rejects duplicate routes", () => {
    expect(() =>
      new RouteRegistry()
        .get("/a", () => text("1"))
        .get("/a", () => text("2")),
    ).toThrow(/duplicate/);
  });
});
