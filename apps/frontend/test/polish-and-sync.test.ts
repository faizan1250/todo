import { describe, it, expect, mock } from "bun:test";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { Skeleton } from "../src/components/ui/skeleton";
import {
  TaskRowSkeleton,
  TaskRowSkeletonList,
  SidebarSkeleton,
  ProfileCardSkeleton,
  StatsWidgetSkeleton,
  TaskDetailSkeleton,
} from "../src/components/app/task-skeleton";
import { EmptyState } from "../src/components/app/empty-state";
import {
  KeyboardShortcutsModal,
  SHORTCUTS_DATA,
} from "../src/components/app/keyboard-shortcuts-modal";
import { NetworkBanner } from "../src/components/app/network-banner";
import { ErrorBoundary } from "../src/components/app/error-boundary";
import { updateCurrentProfile, getCurrentProfile, ApiError } from "../src/lib/api";

describe("Frontend Phase 1 Polish & Profile Sync", () => {
  describe("Accessible Skeleton Loaders", () => {
    it("renders Skeleton with role='status' and pulsing animation", () => {
      const html = renderToString(React.createElement(Skeleton, { className: "h-6 w-32" }));
      expect(html).toContain('role="status"');
      expect(html).toContain("Loading content");
      expect(html).toContain("animate-pulse");
      expect(html).toContain("h-6 w-32");
    });

    it("renders TaskRowSkeleton with checkbox, metadata, and chips", () => {
      const html = renderToString(React.createElement(TaskRowSkeleton));
      expect(html).toContain('role="status"');
      expect(html).toContain("Loading task");
      expect(html).toContain("rounded-xl");
    });

    it("renders TaskRowSkeletonList with specified count", () => {
      const html = renderToString(React.createElement(TaskRowSkeletonList, { count: 3 }));
      expect(html).toContain('role="status"');
      expect(html).toContain("Loading task list");
      // 3 items should have 3 task skeleton wrappers
      const matches = html.match(/aria-label="Loading task"/g);
      expect(matches?.length).toBe(3);
    });

    it("renders SidebarSkeleton with navigation item placeholders", () => {
      const html = renderToString(React.createElement(SidebarSkeleton, { isCollapsed: false }));
      expect(html).toContain("Loading sidebar navigation");
      const itemMatches = html.match(/aria-label="Loading navigation item"/g);
      expect(itemMatches?.length).toBe(7); // 4 views + 3 folders
    });

    it("renders ProfileCardSkeleton and TaskDetailSkeleton with accessibility landmarks", () => {
      const profileHtml = renderToString(React.createElement(ProfileCardSkeleton));
      expect(profileHtml).toContain("Loading profile details");

      const detailHtml = renderToString(React.createElement(TaskDetailSkeleton));
      expect(detailHtml).toContain("Loading task detail");

      const statsHtml = renderToString(React.createElement(StatsWidgetSkeleton));
      expect(statsHtml).toContain("Loading statistics widget");
    });
  });

  describe("Illustrated Empty States", () => {
    it("renders search empty state with query and Clear Search action", () => {
      const onActionMock = mock(() => {});
      const html = renderToString(
        React.createElement(EmptyState, {
          type: "search",
          searchQuery: "crypto-engine",
          onAction: onActionMock,
        })
      );

      expect(html).toContain('role="region"');
      expect(html).toContain('No tasks matching &quot;crypto-engine&quot;');
      expect(html).toContain("Clear Search");
    });

    it("renders today empty state with All Clear messaging", () => {
      const html = renderToString(
        React.createElement(EmptyState, {
          activeList: "today",
          onAction: () => {},
        })
      );

      expect(html).toContain("All clear for today!");
      expect(html).toContain("Create a task");
    });

    it("renders upcoming empty state with milestone scheduling messaging", () => {
      const html = renderToString(
        React.createElement(EmptyState, {
          activeList: "upcoming",
          onAction: () => {},
        })
      );

      expect(html).toContain("No upcoming milestones");
      expect(html).toContain("Add upcoming task");
    });

    it("renders backlog empty state with technical debt capture messaging", () => {
      const html = renderToString(
        React.createElement(EmptyState, {
          activeList: "backlog",
          onAction: () => {},
        })
      );

      expect(html).toContain("Engineering backlog is empty");
      expect(html).toContain("Add to backlog");
    });

    it("renders completed empty state with streak celebration encouragement", () => {
      const html = renderToString(
        React.createElement(EmptyState, {
          activeList: "completed",
          onAction: () => {},
        })
      );

      expect(html).toContain("Nothing completed yet");
      expect(html).toContain("View active tasks");
    });

    it("renders folder empty state with dynamic folder name", () => {
      const html = renderToString(
        React.createElement(EmptyState, {
          activeFolder: "engineering",
          onAction: () => {},
        })
      );

      expect(html).toContain("No tasks in Engineering");
      expect(html).toContain("Create task in folder");
    });

    it("renders secondary action button when provided", () => {
      const html = renderToString(
        React.createElement(EmptyState, {
          type: "filter",
          onAction: () => {},
          actionLabel: "Reset filters",
          secondaryAction: () => {},
          secondaryActionLabel: "View all tasks",
        })
      );

      expect(html).toContain("Reset filters");
      expect(html).toContain("View all tasks");
    });
  });

  describe("Global Keyboard Shortcuts & Cheat Sheet", () => {
    it("contains complete keyboard shortcuts registry covering all core workflows", () => {
      const keysFlattened = SHORTCUTS_DATA.flatMap((s) => s.keys);
      expect(keysFlattened).toContain("J");
      expect(keysFlattened).toContain("K");
      expect(keysFlattened).toContain("⌘K");
      expect(keysFlattened).toContain("/");
      expect(keysFlattened).toContain("N");
      expect(keysFlattened).toContain("Space");
      expect(keysFlattened).toContain("X");
      expect(keysFlattened).toContain("D");
      expect(keysFlattened).toContain("⌫");
      expect(keysFlattened).toContain("?");
      expect(keysFlattened).toContain("Esc");
    });

    it("partitions shortcuts into Navigation, Task Actions, and General categories", () => {
      const categories = new Set(SHORTCUTS_DATA.map((s) => s.category));
      expect(categories.has("Navigation")).toBe(true);
      expect(categories.has("Task Actions")).toBe(true);
      expect(categories.has("General")).toBe(true);
    });

    it("renders KeyboardShortcutsModal dialog when open", () => {
      const html = renderToString(
        React.createElement(KeyboardShortcutsModal, {
          isOpen: true,
          onClose: () => {},
        })
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain("Keyboard Shortcuts");
      expect(html).toContain("Navigate to next task");
      expect(html).toContain("Quick focus task creation input");
    });

    it("returns null when KeyboardShortcutsModal isOpen is false", () => {
      const html = renderToString(
        React.createElement(KeyboardShortcutsModal, {
          isOpen: false,
          onClose: () => {},
        })
      );

      expect(html).toBe("");
    });
  });

  describe("Profile Preferences Two-Way Sync", () => {
    const originalFetch = globalThis.fetch;

    it("sends PATCH /me with updated theme preference", async () => {
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        expect(url.toString()).toContain("/me");
        expect(init?.method).toBe("PATCH");
        expect(init?.credentials).toBe("include");
        capturedBody = JSON.parse(init?.body as string);

        return new Response(
          JSON.stringify({
            id: "usr_faizan",
            name: "Faizan Khan",
            email: "faizan@example.com",
            emailVerified: true,
            image: null,
            twoFactorEnabled: false,
            role: "admin",
            timezone: "America/New_York",
            locale: "en-US",
            weekStartsOn: 1,
            preferences: capturedBody.preferences as Record<string, unknown>,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const updated = await updateCurrentProfile({
        preferences: { theme: "dark", defaultListId: "upcoming" },
      });

      expect(capturedBody.preferences).toBeDefined();
      expect((capturedBody.preferences as Record<string, unknown>).theme).toBe("dark");
      expect((capturedBody.preferences as Record<string, unknown>).defaultListId).toBe(
        "upcoming"
      );
      expect(updated.preferences.theme).toBe("dark");
      expect(updated.preferences.defaultListId).toBe("upcoming");

      globalThis.fetch = originalFetch;
    });

    it("handles preference sync errors gracefully with ApiError", async () => {
      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify({ error: "Invalid preference schema" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      });

      expect(
        updateCurrentProfile({ preferences: { theme: "invalid-theme" } })
      ).rejects.toThrow("Invalid preference schema");

      globalThis.fetch = originalFetch;
    });
  });

  describe("Network Banner & Error Boundary", () => {
    it("renders NetworkBanner in offline mode with alert role and retry action", () => {
      const html = renderToString(
        React.createElement(NetworkBanner, {
          forceOffline: true,
        })
      );

      expect(html).toContain('role="alert"');
      expect(html).toContain("Backend Offline (:3001)");
      expect(html).toContain("Running in local resilient mode");
      expect(html).toContain("Retry");
    });

    it("renders nothing when NetworkBanner forceOffline is false", () => {
      const html = renderToString(
        React.createElement(NetworkBanner, {
          forceOffline: false,
        })
      );

      expect(html).toBe("");
    });

    it("renders children in ErrorBoundary when no error occurs", () => {
      const child = React.createElement("div", null, "Safe Component Content");
      const html = renderToString(
        React.createElement(ErrorBoundary, null, child)
      );

      expect(html).toContain("Safe Component Content");
      expect(html).not.toContain("Something went wrong");
    });

    it("renders fallback UI in ErrorBoundary when initialized in error state", () => {
      const boundary = new ErrorBoundary({ children: "child" });
      const errorState = ErrorBoundary.getDerivedStateFromError(new Error("Database offline"));
      expect(errorState.hasError).toBe(true);
      expect(errorState.error?.message).toBe("Database offline");

      boundary.state = errorState;
      const rendered = boundary.render();
      const html = renderToString(rendered as React.ReactElement);

      expect(html).toContain('role="alert"');
      expect(html).toContain("Something went wrong in this view");
      expect(html).toContain("Database offline");
      expect(html).toContain("Try Again");
      expect(html).toContain("Reload Page");
    });
  });
});
