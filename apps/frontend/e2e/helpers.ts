import { expect, type Page } from "@playwright/test";

export const API_URL = "http://localhost:3001";

export interface TestUser {
  email: string;
  password: string;
  name: string;
}

export function makeTestUser(prefix: string): TestUser {
  const rand = Math.random().toString(36).slice(2, 8);
  return {
    email: `${prefix}-${Date.now()}-${rand}@example.com`,
    password: "Password123!",
    name: `${prefix} ${rand}`,
  };
}

/** Create a user via the backend sign-up API (open registration, no invite). */
export async function signUpViaApi(user: TestUser): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      name: user.name,
    }),
  });
  if (!res.ok) {
    throw new Error(`sign-up API failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Sign in through the /sign-in page, then land on the app workspace with
 * the task quick-add input visible.
 */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto("/sign-in");
  // NOTE: form <label>s carry no htmlFor, so label association does not
  // exist in the a11y tree; target the registered field names instead.
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Sign-in page redirects to "/" on success.
  await page.waitForURL("/", { timeout: 20_000 });
  await ensureWorkspace(page);
}

/** Switch from landing to the app workspace if needed; wait for quick-add. */
export async function ensureWorkspace(page: Page): Promise<void> {
  const quickAdd = page.getByTestId("quick-add-input");
  try {
    await expect(quickAdd.first()).toBeVisible({ timeout: 5_000 });
    return;
  } catch {
    // Still on the landing view: flip to the workspace tab.
  }
  await page.getByRole("button", { name: "App Workspace" }).first().click();
  await expect(quickAdd.first()).toBeVisible({ timeout: 20_000 });
}

export function taskRow(page: Page, title: string) {
  return page.getByRole("button", { name: `Task: ${title}`, exact: true });
}

/** Create a task via quick-add and wait until it renders locally. */
export async function quickAddTask(page: Page, title: string): Promise<void> {
  const input = page.getByTestId("quick-add-input").first();
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.fill(title);
  await input.press("Enter");
  await expect(taskRow(page, title)).toBeVisible({ timeout: 20_000 });
}

/** Rename a task through its detail panel (title input). */
export async function renameTask(
  page: Page,
  oldTitle: string,
  newTitle: string
): Promise<void> {
  await taskRow(page, oldTitle).click();
  // The detail panel's title input sits right after the "Task Title" label.
  const titleInput = page.locator(
    'xpath=//label[normalize-space(.)="Task Title"]/following-sibling::input[1]'
  );
  await expect(titleInput).toBeVisible({ timeout: 20_000 });
  await expect(titleInput).toHaveValue(oldTitle, { timeout: 20_000 });
  await titleInput.fill(newTitle);
  await titleInput.press("Enter").catch(() => {});
  // Detail panel reflects the edit once the local write is applied.
  await expect(
    page.locator(
      'xpath=//label[normalize-space(.)="Task Title"]/following-sibling::input[1]'
    )
  ).toHaveValue(newTitle, { timeout: 20_000 });
}
