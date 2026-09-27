import { describe, expect, it } from "vitest";
import { initialPhase, transition } from "../src/phase.js";

describe("phase transition", () => {
  it("starts in AwaitRequestLine", () => {
    expect(initialPhase().kind).toBe("AwaitRequestLine");
  });

  it("moves to Closed on peer-close", () => {
    const result = transition(initialPhase(), { type: "peer-close" });
    expect(result.phase.kind).toBe("Closed");
  });

  it("Write keepAlive goes to IdleWait", () => {
    const writing = {
      kind: "Write" as const,
      response: {
        status: 200 as const,
        headers: new Map<string, string>(),
        body: { kind: "none" as const },
        desire: "keep-alive" as const,
      },
      keepAlive: true,
    };
    const result = transition(writing, { type: "write-done", keepAlive: true });
    expect(result.phase.kind).toBe("IdleWait");
  });

  it("IdleWait idle-timeout closes", () => {
    const result = transition(
      { kind: "IdleWait" },
      { type: "idle-timeout" },
    );
    expect(result.phase.kind).toBe("Closed");
    if (result.phase.kind === "Closed") {
      expect(result.phase.reason).toBe("idle-timeout");
    }
  });
});
