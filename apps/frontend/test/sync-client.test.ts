import { describe, it, expect } from "bun:test";
import { CLIENT_VERSION, SyncUpdateRequired } from "../src/lib/sync/client";
import type { SyncMutation, SyncOp } from "../src/lib/sync/outbox";
import * as socket from "../src/lib/sync/socket";

// NOTE: Dexie needs IndexedDB, which bun test does not provide
// (no fake-indexeddb / happy-dom installed), so outbox/meta cursor
// round-trips (enqueue/getPending/removeAcked/incrementAttempts,
// getCursor) cannot run here — they throw MissingAPIError. These tests
// cover what is importable without IndexedDB side effects.

function isValidMutation(m: SyncMutation): boolean {
  return (
    typeof m.id === "string" &&
    typeof m.entity === "string" &&
    (m.op === "upsert" || m.op === "delete") &&
    typeof m.entityId === "string" &&
    typeof m.editedAt === "number"
  );
}

describe("sync client (no-IndexedDB)", () => {
  it("CLIENT_VERSION is defined", () => {
    expect(typeof CLIENT_VERSION).toBe("string");
    expect(CLIENT_VERSION.length).toBeGreaterThan(0);
  });

  it("CLIENT_VERSION matches the expected protocol version", () => {
    expect(CLIENT_VERSION).toBe("1");
  });

  it("SyncUpdateRequired is an Error subclass", () => {
    const err = new SyncUpdateRequired("stale");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SyncUpdateRequired);
  });

  it("SyncUpdateRequired carries the custom message", () => {
    const err = new SyncUpdateRequired("custom message");
    expect(err.message).toBe("custom message");
    expect(err.name).toBe("SyncUpdateRequired");
  });

  it("SyncUpdateRequired has a default message", () => {
    const err = new SyncUpdateRequired();
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("accepts a valid upsert mutation shape", () => {
    const m: SyncMutation = {
      id: "0193abcd-0000-7000-8000-000000000001",
      entity: "tasks",
      op: "upsert",
      entityId: "task-1",
      patch: { title: "Buy milk" },
      editedAt: Date.now(),
    };
    expect(isValidMutation(m)).toBe(true);
  });

  it("accepts a valid delete mutation shape without patch", () => {
    const m: SyncMutation = {
      id: "0193abcd-0000-7000-8000-000000000002",
      entity: "lists",
      op: "delete" as SyncOp,
      entityId: "list-1",
      editedAt: Date.now(),
    };
    expect(isValidMutation(m)).toBe(true);
    expect("patch" in m).toBe(false);
  });

  it("rejects a mutation with an unknown op", () => {
    const m = {
      id: "x",
      entity: "tasks",
      op: "merge",
      entityId: "task-1",
      editedAt: Date.now(),
    } as unknown as SyncMutation;
    expect(isValidMutation(m)).toBe(false);
  });

  it("connectSyncSocket is a safe no-op outside the browser", () => {
    expect(typeof socket.connectSyncSocket).toBe("function");
    const cleanup = socket.connectSyncSocket(() => {});
    expect(typeof cleanup).toBe("function");
    expect(() => cleanup()).not.toThrow();
  });

  it("socket URL helper is not exported (derivation untestable here)", () => {
    expect(Object.keys(socket).sort()).toEqual(["connectSyncSocket"]);
  });
});
