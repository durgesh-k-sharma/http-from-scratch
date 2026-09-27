import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveInJail, staticFiles } from "../src/static.js";
import { createRequest } from "../src/route-table.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../examples/public");

describe("resolveInJail", () => {
  it("allows files under root", async () => {
    const resolved = await resolveInJail(publicDir, "/hello.txt");
    expect(resolved).toBeTruthy();
    expect(resolved?.endsWith("hello.txt")).toBe(true);
  });

  it("rejects path traversal", async () => {
    const resolved = await resolveInJail(publicDir, "/../package.json");
    expect(resolved).toBeNull();
  });

  it("rejects encoded traversal", async () => {
    const resolved = await resolveInJail(publicDir, "/foo/../../etc/passwd");
    expect(resolved).toBeNull();
  });
});

describe("staticFiles", () => {
  it("serves a text file", async () => {
    const handler = staticFiles({ root: publicDir });
    const req = createRequest({ method: "GET", path: "/hello.txt" });
    const res = await handler(req);
    expect(res.status).toBe(200);
    if (res.body.kind === "bytes") {
      expect(Buffer.from(res.body.bytes).toString()).toContain("hello from static");
    }
  });

  it("serves index.html for directory", async () => {
    const handler = staticFiles({ root: publicDir });
    const req = createRequest({ method: "GET", path: "/" });
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("404s missing files", async () => {
    const handler = staticFiles({ root: publicDir });
    const req = createRequest({ method: "GET", path: "/no-such-file" });
    const res = await handler(req);
    expect(res.status).toBe(404);
  });
});
