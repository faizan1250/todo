import { test, expect } from "@playwright/test";
import {
  makeTestUser,
  signUpViaApi,
  signIn,
  ensureWorkspace,
  quickAddTask,
  renameTask,
  taskRow,
} from "./helpers";

// Separate browser contexts = separate cookie jars + separate IndexedDB =
// two simulated devices for the same user.
test.describe("multi-device sync", () => {
  test("task created on device A appears on device B", async ({ browser }) => {
    const user = makeTestUser("sync-a-b");
    await signUpViaApi(user);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      await signIn(pageA, user);
      await signIn(pageB, user);

      const title = `A-to-B ${Date.now()}`;
      await quickAddTask(pageA, title);

      // Realtime WS push should deliver this in seconds; 20s is generous.
      await expect(taskRow(pageB, title)).toBeVisible({ timeout: 20_000 });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("offline edit on B converges on A with no duplicates", async ({
    browser,
  }) => {
    const user = makeTestUser("sync-offline");
    await signUpViaApi(user);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      await signIn(pageA, user);
      await signIn(pageB, user);

      const before = `offline-before ${Date.now()}`;
      const after = `offline-after ${Date.now()}`;
      await quickAddTask(pageA, before);
      await expect(taskRow(pageB, before)).toBeVisible({ timeout: 20_000 });

      await ctxB.setOffline(true);
      await renameTask(pageB, before, after);
      // While offline, A must still show the old title.
      await expect(taskRow(pageA, before)).toBeVisible({ timeout: 20_000 });
      await ctxB.setOffline(false);

      // Reconnect drains the outbox; A converges on the new title exactly once.
      await expect(taskRow(pageA, after)).toBeVisible({ timeout: 30_000 });
      await expect(taskRow(pageA, after)).toHaveCount(1);
      await expect(taskRow(pageA, before)).toHaveCount(0);
    } finally {
      await ctxB.setOffline(false).catch(() => {});
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("sync still converges via pull when realtime WS is blocked", async ({
    browser,
  }) => {
    const user = makeTestUser("sync-nows");
    await signUpViaApi(user);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      await signIn(pageA, user);

      // Device B never gets a socket: abort the WS upgrade before load.
      const pageB = await ctxB.newPage();
      await pageB.route("**/ws", (route) => route.abort());
      await signIn(pageB, user);

      const title = `no-ws ${Date.now()}`;
      await quickAddTask(pageA, title);

      // Without realtime push, B only learns via pull: a reload runs the
      // initial sync and must bring the task in.
      await pageB.reload();
      await ensureWorkspace(pageB);
      await expect(taskRow(pageB, title)).toBeVisible({ timeout: 30_000 });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
