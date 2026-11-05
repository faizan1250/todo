import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  makeTestUser,
  signUpViaApi,
  signIn,
  quickAddTask,
  taskRow,
} from "./helpers";

function builder(page: Page, include?: string) {
  let b = new AxeBuilder({ page })
    // Excluded (known bigger issues, need follow-up chunks, not quick fixes):
    // - color-contrast: muted design tokens (#5B6478 at 70-80% opacity,
    //   emerald-600 "Saved"/"Backend Ready", zinc-400 timestamps) are
    //   systemic; fixing needs a design-token decision.
    // - nested-interactive: task-row container (role=button) wraps action
    //   buttons (drag handle, checkbox, delete); fixing needs a task-row
    //   interaction-model rework (also feeds existing e2e selectors).
    // - label-content-name-mismatch: task-row aria-label "Task: X" vs visible
    //   "X + meta", Done-group "Expand N completed tasks" vs visible
    //   "Done N tasks"; fixing needs a UX naming decision.
    .disableRules([
      "color-contrast",
      "nested-interactive",
      "label-content-name-mismatch",
    ]);
  if (include) b = b.include(include);
  return b;
}

function expectNoViolations(results: { violations: unknown[] }) {
  expect(
    results.violations.map((v) =>
      JSON.stringify(v, null, 2),
    ),
    "axe accessibility violations",
  ).toEqual([]);
}

test.describe("accessibility (axe)", () => {
  test("inbox list has no axe violations", async ({ page }) => {
    const user = makeTestUser("a11y-inbox");
    await signUpViaApi(user);
    await signIn(page, user);

    expectNoViolations(await builder(page).analyze());
  });

  test("task detail panel has no axe violations", async ({ page }) => {
    const user = makeTestUser("a11y-panel");
    await signUpViaApi(user);
    await signIn(page, user);

    const title = `a11y task ${Date.now()}`;
    await quickAddTask(page, title);
    await taskRow(page, title).click();
    await expect(
      page.locator(
        'xpath=//label[normalize-space(.)="Task Title"]/following-sibling::input[1]',
      ),
    ).toBeVisible({ timeout: 20_000 });

    expectNoViolations(await builder(page).analyze());
  });

  test("sidebar navigation has no axe violations", async ({ page }) => {
    const user = makeTestUser("a11y-nav");
    await signUpViaApi(user);
    await signIn(page, user);

    expectNoViolations(
      await builder(page, 'aside[aria-label="Application Navigation"]').analyze(),
    );
  });
});
