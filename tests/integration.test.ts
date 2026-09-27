import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, json, text, silentLogger } from "../src/index.js";

type Handle = {
  host: string;
  port: number;
  close: () => Promise<void>;
};

const handles: Handle[] = [];

afterEach(async () => {
  while (handles.length) {
    const h = handles.pop();
    if (h) await h.close();
  }
});

async function start() {
  const server = createServer({
    host: "127.0.0.1",
    port: 0,
    logger: silentLogger,
  });
  server.get("/hello", () => text("hi"));
  server.get("/users/:id", (req) => json({ id: req.params.get("id") }));
  server.post("/echo", (req) => {
    if (req.body.kind === "none") return json({ error: "no body" }, 400);
    return json({
      n: req.body.bytes.byteLength,
      t: Buffer.from(req.body.bytes).toString("utf8"),
    });
  });
  server.put("/items/:id", (req) => json({ updated: req.params.get("id") }));
  server.delete("/items/:id", (req) => json({ deleted: req.params.get("id") }));

  const bound = await server.listen();
  const handle = {
    host: bound.host,
    port: bound.port,
    close: () => server.close(),
  };
  handles.push(handle);
  return handle;
}

function rawRequest(
  port: number,
  payload: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.write(payload);
    });
    const chunks: Buffer[] = [];
    socket.on("data", (c) => chunks.push(c));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error("timeout"));
    });
  });
}

describe("integration over raw TCP", () => {
  it("serves GET", async () => {
    const { port } = await start();
    const res = await rawRequest(
      port,
      "GET /hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(res).toContain("HTTP/1.1 200 OK");
    expect(res).toContain("hi");
  });

  it("serves path params", async () => {
    const { port } = await start();
    const res = await rawRequest(
      port,
      "GET /users/7 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(res).toContain('"id":"7"');
  });

  it("serves POST body", async () => {
    const { port } = await start();
    const body = "abc";
    const res = await rawRequest(
      port,
      `POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
    );
    expect(res).toContain('"n":3');
    expect(res).toContain('"t":"abc"');
  });

  it("serves PUT and DELETE", async () => {
    const { port } = await start();
    const put = await rawRequest(
      port,
      "PUT /items/1 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    );
    expect(put).toContain('"updated":"1"');

    const { port: port2 } = await start();
    const del = await rawRequest(
      port2,
      "DELETE /items/1 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(del).toContain('"deleted":"1"');
  });

  it("keeps connection alive for a second request", async () => {
    const { port } = await start();
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        socket.write(
          "GET /hello HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n",
        );
      });
      let buf = Buffer.alloc(0);
      let sentSecond = false;
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const text = buf.toString("utf8");
        if (!sentSecond && text.includes("\r\n\r\n") && text.includes("hi")) {
          sentSecond = true;
          socket.write(
            "GET /hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
          );
        }
        if (sentSecond && (text.match(/HTTP\/1\.1 200 OK/g) ?? []).length >= 2) {
          socket.end();
          resolve(text);
        }
      });
      socket.on("error", reject);
      socket.setTimeout(3000, () => {
        socket.destroy();
        reject(new Error("keepalive timeout"));
      });
    });

    expect((response.match(/HTTP\/1\.1 200 OK/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("returns 404 for unknown routes", async () => {
    const { port } = await start();
    const res = await rawRequest(
      port,
      "GET /nope HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(res).toContain("HTTP/1.1 404");
  });
});
