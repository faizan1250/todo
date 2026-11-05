import { describe, expect, it } from "bun:test";
import * as fc from "fast-check";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";

type View = Map<string, { title: string; status: string; priority: number; deleted: boolean }>;

function summarize(row: any) {
  return {
    title: row.title as string,
    status: row.status as string,
    priority: (row.priority ?? 0) as number,
    deleted: row.deletedAt != null,
  };
}

describe("Phase 5 Sync Convergence (property-based)", () => {
  async function getUserInboxId(authHeaders: Record<string, string>): Promise<string> {
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/lists", { headers: authHeaders })
    );
    expect(res.status).toBe(200);
    const userLists = (await res.json()) as Array<{ id: string; isInbox: boolean }>;
    const inbox = userLists.find((l) => l.isInbox);
    expect(inbox).toBeDefined();
    return inbox!.id;
  }

  function headersFor(authHeaders: Record<string, string>, deviceId: string) {
    return { ...authHeaders, "x-device-id": deviceId };
  }

  async function push(
    authHeaders: Record<string, string>,
    deviceId: string,
    mutations: any[]
  ) {
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/sync/push", {
        method: "POST",
        headers: headersFor(authHeaders, deviceId),
        body: JSON.stringify({ deviceId, mutations }),
      })
    );
    expect(res.status).toBe(200);
    return (await res.json()) as { results: Array<{ id: string; status: string; reason?: string }> };
  }

  async function pullAll(
    authHeaders: Record<string, string>,
    deviceId: string,
    cursor: string
  ): Promise<{ tasks: any[]; cursor: string }> {
    const tasks: any[] = [];
    let c = cursor;
    for (let page = 0; page < 20; page++) {
      const url = c
        ? `http://localhost:3001/api/v1/sync?cursor=${encodeURIComponent(c)}`
        : "http://localhost:3001/api/v1/sync";
      const res = await app.handle(
        new Request(url, { headers: headersFor(authHeaders, deviceId) })
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      tasks.push(...(data.changes?.tasks ?? []));
      c = data.cursor;
      if (!data.hasMore) break;
    }
    return { tasks, cursor: c };
  }

  // Raw generated instruction; resolved against live model state at execution.
  const opArb = fc.record({
    device: fc.integer({ min: 0, max: 2 }),
    kind: fc.integer({ min: 0, max: 5 }), // 0 create,1 upd-title,2 upd-prio,3 complete,4 delete,5 restore
    target: fc.nat({ max: 7 }),
    title: fc.constantFrom("Alpha", "Beta", "Gamma", "Delta", "Epsilon"),
    priority: fc.integer({ min: 0, max: 3 }),
  });
  const seqArb = fc.array(opArb, { minLength: 5, maxLength: 15 });

  it(
    "3 devices of one user converge after random op sequences",
    async () => {
      const { authHeaders } = await createAuthUser("SyncConv");
      const inboxId = await getUserInboxId(authHeaders);
      const devices = ["conv-dev-A", "conv-dev-B", "conv-dev-C"];

      const runTag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const initial = await pullAll(authHeaders, devices[0], "");
      const cursor0 = initial.cursor;
      const base = Date.now();

      const NUM_SEEDS = 50;
      let totalOps = 0;

      for (let seed = 1; seed <= NUM_SEEDS; seed++) {
        const ops = fc.sample(seqArb, { seed, numRuns: 1 })[0];
        const prefix = `cv-${runTag}-s${seed}`;
        const created: string[] = [];
        const appliedCreates = new Set<string>();
        let clock = 0;

        for (let i = 0; i < ops.length; i++) {
          const op = ops[i];
          const device = devices[op.device];
          const editedAt = base + clock++;
          const mid = `${prefix}-${i}`;
          let mutation: any;

          if (op.kind === 0 || created.length === 0) {
            const entityId = `t-${mid}`;
            created.push(entityId);
            mutation = {
              id: `m-${mid}`,
              entity: "tasks",
              op: "create",
              entityId,
              patch: { title: `Task ${op.title}`, listId: inboxId, priority: op.priority },
              editedAt,
            };
          } else {
            const entityId = created[op.target % created.length];
            if (op.kind === 1) {
              mutation = {
                id: `m-${mid}`, entity: "tasks", op: "update", entityId,
                patch: { title: `Task ${op.title} v${i}` }, editedAt,
              };
            } else if (op.kind === 2) {
              mutation = {
                id: `m-${mid}`, entity: "tasks", op: "update", entityId,
                patch: { priority: op.priority }, editedAt,
              };
            } else if (op.kind === 3) {
              mutation = {
                id: `m-${mid}`, entity: "tasks", op: "complete", entityId,
                patch: {}, editedAt,
              };
            } else if (op.kind === 4) {
              mutation = {
                id: `m-${mid}`, entity: "tasks", op: "delete", entityId, editedAt,
              };
            } else {
              mutation = {
                id: `m-${mid}`, entity: "tasks", op: "restore", entityId, editedAt,
              };
            }
          }

          const data = await push(authHeaders, device, [mutation]);
          totalOps++;
          if (mutation.op === "create" && data.results[0]?.status === "applied") {
            appliedCreates.add(mutation.entityId);
          }

          // Interleaved sync traffic in random order: a random device pulls mid-sequence.
          if (i % 4 === 3) {
            const observer = devices[(op.target + i) % devices.length];
            await pullAll(authHeaders, observer, i % 8 === 7 ? "" : cursor0);
          }
        }

        // Full sync: every device pulls the whole delta from the pre-run cursor.
        const views: View[] = [];
        for (const d of devices) {
          const delta = await pullAll(authHeaders, d, cursor0);
          const view: View = new Map();
          for (const row of delta.tasks) view.set(row.id, summarize(row));
          views.push(view);
        }

        // Server live state via a fresh full pull (excludes tombstones).
        const live = await pullAll(authHeaders, devices[0], "");
        const liveMap: View = new Map();
        for (const row of live.tasks) liveMap.set(row.id, summarize(row));

        // 1. No applied create is lost.
        for (const id of appliedCreates) {
          expect(views[0].has(id), `seed ${seed}: applied create ${id} missing`).toBe(true);
        }

        // 2. All three device views identical (this seed's ids).
        const scoped = views.map((v) => {
          const m: Record<string, unknown> = {};
          for (const id of created) m[id] = v.get(id) ?? null;
          return m;
        });
        expect(scoped[1], `seed ${seed}: device B diverged`).toEqual(scoped[0]);
        expect(scoped[2], `seed ${seed}: device C diverged`).toEqual(scoped[1]);

        // 3. Device views consistent with server live state.
        for (const id of created) {
          const v = views[0].get(id)!;
          const liveRow = liveMap.get(id);
          if (v.deleted) {
            expect(liveRow, `seed ${seed}: deleted ${id} still live`).toBeUndefined();
          } else {
            expect(liveRow, `seed ${seed}: live ${id} missing from server`).toBeDefined();
            expect(liveRow, `seed ${seed}: live ${id} differs`).toEqual(v);
          }
        }
      }

      expect(totalOps).toBeGreaterThan(0);
    },
    { timeout: 120_000 }
  );
});
