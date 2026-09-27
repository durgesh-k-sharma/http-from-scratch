/**
 * Live verification against the done predicate.
 * Starts the example server, exercises methods/static/keep-alive, then exits.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const port = 18080 + Math.floor(Math.random() * 1000);
const host = "127.0.0.1";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPort(ms = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await new Promise<void>((resolve, reject) => {
        const s = net.connect({ host, port }, () => {
          s.end();
          resolve();
        });
        s.on("error", reject);
      });
      return;
    } catch {
      await sleep(50);
    }
  }
  throw new Error("server did not start");
}

function request(payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port }, () => socket.write(payload));
    const chunks: Buffer[] = [];
    socket.on("data", (c) => chunks.push(c));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("request timeout"));
    });
  });
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const child = spawn(
  "npx",
  ["tsx", "examples/cli.ts", "--host", host, "--port", String(port)],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  },
);

let stderr = "";
child.stderr?.on("data", (d) => {
  stderr += d.toString();
});

try {
  await waitForPort();

  const get = await request(
    "GET /api/hello?name=live HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
  );
  assert(get.includes("200 OK"), "GET status");
  assert(get.includes("hello, live"), "GET body");

  const postBody = '{"x":1}';
  const post = await request(
    `POST /api/echo HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${postBody.length}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n${postBody}`,
  );
  assert(post.includes("200 OK"), "POST status");

  const put = await request(
    "PUT /api/items/9 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
  );
  assert(put.includes('"updated":"9"'), "PUT body");

  const del = await request(
    "DELETE /api/items/9 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
  );
  assert(del.includes('"deleted":"9"'), "DELETE body");

  const file = await request(
    "GET /static/hello.txt HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
  );
  assert(file.includes("200 OK"), "static status");
  assert(file.includes("hello from static"), "static body");

  const missing = await request(
    "GET /no-such-route HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
  );
  assert(missing.includes("404"), "404");

  // keep-alive: two requests one socket
  const ka = await new Promise<string>((resolve, reject) => {
    const socket = net.connect({ host, port }, () => {
      socket.write(
        "GET /api/hello HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n",
      );
    });
    let buf = Buffer.alloc(0);
    let second = false;
    socket.on("data", (c) => {
      buf = Buffer.concat([buf, c]);
      const t = buf.toString("utf8");
      if (!second && t.includes("\r\n\r\n")) {
        second = true;
        socket.write(
          "GET /api/hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        );
      }
      if (second && (t.match(/HTTP\/1\.1 200 OK/g) ?? []).length >= 2) {
        socket.end();
        resolve(t);
      }
    });
    socket.on("error", reject);
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("keepalive timeout"));
    });
  });
  assert(
    (ka.match(/HTTP\/1\.1 200 OK/g) ?? []).length >= 2,
    "keep-alive two responses",
  );

  console.log("verify:live PASS");
  child.kill("SIGTERM");
  process.exit(0);
} catch (err) {
  console.error("verify:live FAIL", err);
  console.error(stderr);
  child.kill("SIGKILL");
  process.exit(1);
}
