import { describe, it, expect, mock, afterEach } from "bun:test";
import * as React from "react";
import { renderToString } from "react-dom/server";
import {
  formatEstimate,
  formatDateWithTime,
  backendTaskToTaskItem,
  taskItemToBackendCreateInput,
  taskItemToBackendUpdateInput,
  computeEstimateTotal,
} from "../src/lib/adapters";
import {
  skipTask,
  quickAddTask,
  parseNaturalLanguageText,
  setTaskRecurrence,
  deleteTaskRecurrence,
  getTaskReminders,
  createTaskReminder,
  getPlaces,
  type BackendTask,
} from "../src/lib/api";
import { TaskRow } from "../src/components/app/task-row";
import { TaskDetailPanel } from "../src/components/app/task-detail-panel";
import type { TaskItem } from "../src/components/app/types";

describe("Frontend Phase 3 Smart Scheduling & Quick Add Integration", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("formatEstimate helper", () => {
    it("formats minutes into human readable intervals correctly", () => {
      expect(formatEstimate(30)).toBe("30m");
      expect(formatEstimate(60)).toBe("1h");
      expect(formatEstimate(90)).toBe("1h 30m");
      expect(formatEstimate(125)).toBe("2h 5m");
      expect(formatEstimate(15)).toBe("15m");
    });

    it("returns empty string for zero, negative, or undefined values", () => {
      expect(formatEstimate(0)).toBe("");
      expect(formatEstimate(-10)).toBe("");
      expect(formatEstimate(null)).toBe("");
      expect(formatEstimate(undefined)).toBe("");
    });
  });

  describe("formatDateWithTime helper", () => {
    it("formats with date only when allDay is true", () => {
      const ts = "2026-11-10T15:30:00.000Z";
      const result = formatDateWithTime(ts, true);
      expect(result).not.toContain("at");
      expect(result.length).toBeGreaterThan(0);
    });

    it("formats with date and time when allDay is false", () => {
      const ts = "2026-11-10T15:30:00.000Z";
      const result = formatDateWithTime(ts, false);
      expect(result).toContain("at");
    });

    it("handles null or undefined safely", () => {
      expect(formatDateWithTime(null)).toBe("");
      expect(formatDateWithTime(undefined)).toBe("");
    });
  });

  describe("Adapters scheduling fields mapping", () => {
    it("correctly maps all scheduling and location fields from BackendTask to TaskItem", () => {
      const backendTask: BackendTask = {
        id: "task-test-1",
        userId: "user-1",
        listId: "list-1",
        title: "Grocery Shopping & Planning",
        status: "todo",
        priority: 2,
        position: "a0",
        startAt: "2026-11-05T09:00:00.000Z",
        dueAt: "2026-11-05T17:00:00.000Z",
        deadlineAt: "2026-11-06T12:00:00.000Z",
        allDay: false,
        estimateMin: 45,
        recurrenceId: "rec-weekly-1",
        recurrenceRule: { rrule: "FREQ=WEEKLY;INTERVAL=1", mode: "fixed" },
        placeId: "place-supermarket",
        locationName: "Whole Foods Market",
        lat: 37.7749,
        lng: -122.4194,
        radiusM: 150,
        locationTrigger: "arrive",
        reminders: [
          {
            id: "rem-1",
            userId: "user-1",
            taskId: "task-test-1",
            kind: "relative",
            relativeTo: "due",
            offsetMin: -30,
            remindAt: "2026-11-05T16:30:00.000Z",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            version: 1,
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      };

      const item = backendTaskToTaskItem(backendTask);

      expect(item.id).toBe("task-test-1");
      expect(item.startAt).toBe("2026-11-05T09:00:00.000Z");
      expect(item.dueAt).toBe("2026-11-05T17:00:00.000Z");
      expect(item.deadlineAt).toBe("2026-11-06T12:00:00.000Z");
      expect(item.allDay).toBe(false);
      expect(item.estimateMin).toBe(45);
      expect(item.estimateTotal).toBe(45);
      expect(item.recurrenceId).toBe("rec-weekly-1");
      expect(item.recurrenceRule?.rrule).toBe("FREQ=WEEKLY;INTERVAL=1");
      expect(item.recurrenceRule?.mode).toBe("fixed");
      expect(item.placeId).toBe("place-supermarket");
      expect(item.locationName).toBe("Whole Foods Market");
      expect(item.lat).toBe(37.7749);
      expect(item.lng).toBe(-122.4194);
      expect(item.radiusM).toBe(150);
      expect(item.locationTrigger).toBe("arrive");
      expect(item.reminders?.length).toBe(1);
      expect(item.reminders?.[0].offsetMin).toBe(-30);
    });

    it("calculates rollup estimateTotal across subtasks tree", () => {
      const taskWithSubtasks: BackendTask = {
        id: "task-parent",
        userId: "user-1",
        listId: "list-1",
        title: "Quarterly Release",
        status: "todo",
        priority: 3,
        position: "a0",
        estimateMin: 60, // 1h
        subtasks: [
          {
            id: "task-sub-1",
            userId: "user-1",
            listId: "list-1",
            title: "Database migration",
            status: "todo",
            priority: 2,
            position: "a1",
            estimateMin: 30, // 30m
            createdAt: Date.now(),
            updatedAt: Date.now(),
            version: 1,
          },
          {
            id: "task-sub-2",
            userId: "user-1",
            listId: "list-1",
            title: "Smoke testing",
            status: "todo",
            priority: 2,
            position: "a2",
            estimateMin: 45, // 45m
            createdAt: Date.now(),
            updatedAt: Date.now(),
            version: 1,
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      };

      const total = computeEstimateTotal(taskWithSubtasks);
      expect(total).toBe(135); // 60 + 30 + 45 = 135 (2h 15m)

      const item = backendTaskToTaskItem(taskWithSubtasks);
      expect(item.estimateMin).toBe(60);
      expect(item.estimateTotal).toBe(135);
    });

    it("correctly maps scheduling and location properties in taskItemToBackendCreateInput", () => {
      const input = taskItemToBackendCreateInput(
        {
          title: "Dentist Visit",
          startAt: "2026-11-12T14:00:00.000Z",
          dueAt: "2026-11-12T15:00:00.000Z",
          deadlineAt: "2026-11-12T17:00:00.000Z",
          allDay: false,
          estimateMin: 60,
          locationName: "Downtown Dental",
          placeId: "place-dentist",
          lat: 40.7128,
          lng: -74.006,
          radiusM: 200,
          locationTrigger: "arrive",
        },
        "list-health"
      );

      expect(input.title).toBe("Dentist Visit");
      expect(input.listId).toBe("list-health");
      expect(input.startAt).toBe("2026-11-12T14:00:00.000Z");
      expect(input.dueAt).toBe("2026-11-12T15:00:00.000Z");
      expect(input.deadlineAt).toBe("2026-11-12T17:00:00.000Z");
      expect(input.allDay).toBe(false);
      expect(input.estimateMin).toBe(60);
      expect(input.locationName).toBe("Downtown Dental");
      expect(input.placeId).toBe("place-dentist");
      expect(input.lat).toBe(40.7128);
      expect(input.lng).toBe(-74.006);
      expect(input.radiusM).toBe(200);
      expect(input.locationTrigger).toBe("arrive");
    });

    it("correctly maps scheduling and location properties in taskItemToBackendUpdateInput", () => {
      const update = taskItemToBackendUpdateInput({
        title: "Dentist Visit Rescheduled",
        startAt: "2026-11-15T10:00:00.000Z",
        dueAt: "2026-11-15T11:00:00.000Z",
        allDay: true,
        estimateMin: 90,
        locationName: "New Clinic",
        locationTrigger: "leave",
      });

      expect(update.title).toBe("Dentist Visit Rescheduled");
      expect(update.startAt).toBe("2026-11-15T10:00:00.000Z");
      expect(update.dueAt).toBe("2026-11-15T11:00:00.000Z");
      expect(update.allDay).toBe(true);
      expect(update.estimateMin).toBe(90);
      expect(update.locationName).toBe("New Clinic");
      expect(update.locationTrigger).toBe("leave");
    });
  });

  describe("TaskRow SSR component rendering", () => {
    const baseTask: TaskItem = {
      id: "task-row-1",
      title: "Write design doc for caching layer",
      completed: false,
      priority: "med",
      list: "today",
      folder: "engineering",
      tags: ["arch", "perf"],
      dueDate: "Tomorrow",
      subtasks: [],
      checklist: [],
      createdAt: "Just now",
      updatedAt: "Just now",
    };

    it("renders TaskRow with recurrence badge when recurrenceId is present", () => {
      const task: TaskItem = {
        ...baseTask,
        recurrenceId: "rec-series-42",
      };

      const html = renderToString(
        React.createElement(TaskRow, {
          task,
          onToggleComplete: () => {},
          onSelect: () => {},
          onDelete: () => {},
        })
      );

      expect(html).toContain("data-testid=\"task-recurrence-badge\"");
      expect(html).toContain("Repeat");
    });

    it("renders TaskRow with estimate badge when estimateMin is set", () => {
      const task: TaskItem = {
        ...baseTask,
        estimateMin: 45,
      };

      const html = renderToString(
        React.createElement(TaskRow, {
          task,
          onToggleComplete: () => {},
          onSelect: () => {},
          onDelete: () => {},
        })
      );

      expect(html).toContain("data-testid=\"task-estimate-badge\"");
      expect(html).toContain("45m");
    });

    it("renders TaskRow with location badge when locationName is set", () => {
      const task: TaskItem = {
        ...baseTask,
        locationName: "San Francisco Office",
      };

      const html = renderToString(
        React.createElement(TaskRow, {
          task,
          onToggleComplete: () => {},
          onSelect: () => {},
          onDelete: () => {},
        })
      );

      expect(html).toContain("data-testid=\"task-location-badge\"");
      expect(html).toContain("San Francisco Office");
    });
  });

  describe("TaskDetailPanel SSR rendering with scheduling pills & reminders", () => {
    const scheduledTask: TaskItem = {
      id: "task-panel-1",
      title: "Quarterly Tax Review",
      completed: false,
      priority: "high",
      list: "today",
      folder: "personal",
      tags: ["finance"],
      dueDate: "Today",
      dueAt: "2026-11-04T18:00:00.000Z",
      startAt: "2026-11-04T09:00:00.000Z",
      deadlineAt: "2026-11-04T23:59:00.000Z",
      allDay: false,
      estimateMin: 90,
      estimateTotal: 90,
      recurrenceId: "rec-quarterly-1",
      recurrenceRule: { rrule: "FREQ=MONTHLY;INTERVAL=3", mode: "fixed" },
      locationName: "Accountant Office",
      reminders: [
        {
          id: "rem-1",
          kind: "relative",
          relativeTo: "due",
          offsetMin: -60,
          remindAt: "2026-11-04T17:00:00.000Z",
        },
      ],
      subtasks: [],
      checklist: [],
      createdAt: "Just now",
      updatedAt: "Just now",
    };

    it("renders scheduling attribute pills and reminders section", () => {
      const html = renderToString(
        React.createElement(TaskDetailPanel, {
          task: scheduledTask,
          isOpen: true,
          onClose: () => {},
          onUpdateTask: () => {},
          onDeleteTask: () => {},
        })
      );

      // Check dates pill
      expect(html).toContain("Due:");
      expect(html).toContain("Today");

      // Check recurrence pill
      expect(html).toContain("Repeat:");
      expect(html).toContain("Monthly");

      // Check estimate pill
      expect(html).toContain("Est:");
      expect(html).toContain("1h 30m");

      // Check location pill
      expect(html).toContain("Loc:");
      expect(html).toContain("Accountant Office");

      // Check reminders section
      expect(html).toContain("Reminders");
      expect(html).toContain("Add reminder");
    });
  });

  describe("API methods mocking: skipTask and quickAddTask", () => {
    it("calls POST /api/v1/tasks/:id/skip and returns task with nextTask instance", async () => {
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        expect(url.toString()).toContain("/api/v1/tasks/task-rec-1/skip");
        expect(init?.method).toBe("POST");

        return new Response(
          JSON.stringify({
            id: "task-rec-1",
            userId: "user-1",
            listId: "list-1",
            title: "Daily Standup",
            status: "cancelled",
            priority: 2,
            position: "a0",
            recurrenceId: "rec-daily",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            version: 2,
            nextTask: {
              id: "task-rec-2",
              userId: "user-1",
              listId: "list-1",
              title: "Daily Standup",
              status: "todo",
              priority: 2,
              position: "a1",
              dueAt: "2026-11-05T09:00:00.000Z",
              recurrenceId: "rec-daily",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              version: 1,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const res = await skipTask("task-rec-1");
      expect(res.id).toBe("task-rec-1");
      expect(res.status).toBe("cancelled");
      expect(res.nextTask?.id).toBe("task-rec-2");
      expect(res.nextTask?.status).toBe("todo");
    });

    it("calls POST /api/v1/tasks/quick with text and timezone", async () => {
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        expect(url.toString()).toContain("/api/v1/tasks/quick");
        expect(init?.method).toBe("POST");

        const body = JSON.parse(init?.body as string);
        expect(body.text).toBe("Finish report tomorrow ~45m #work !high");
        expect(body.timezone).toBeDefined();

        return new Response(
          JSON.stringify({
            id: "task-quick-1",
            userId: "user-1",
            listId: "list-work",
            title: "Finish report",
            status: "todo",
            priority: 3,
            position: "a0",
            dueAt: "2026-11-05T12:00:00.000Z",
            estimateMin: 45,
            tags: [{ id: "tag-1", name: "work" }],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            version: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const res = await quickAddTask({
        text: "Finish report tomorrow ~45m #work !high",
        timezone: "America/New_York",
      });

      expect(res.id).toBe("task-quick-1");
      expect(res.title).toBe("Finish report");
      expect(res.estimateMin).toBe(45);
      expect(res.priority).toBe(3);
    });

    it("calls POST /api/v1/parse and returns structured parsed tokens", async () => {
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        expect(url.toString()).toContain("/api/v1/parse");
        expect(init?.method).toBe("POST");

        return new Response(
          JSON.stringify({
            title: "Buy coffee beans",
            dueAt: "2026-11-05T09:00:00.000Z",
            allDay: false,
            priority: 2,
            tags: ["groceries"],
            list: null,
            estimateMin: 15,
            recurrence: { rrule: "FREQ=WEEKLY;INTERVAL=1", mode: "fixed" },
            reminders: [],
            tokens: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const parsed = await parseNaturalLanguageText("Buy coffee beans every week ~15m #groceries");
      expect(parsed.title).toBe("Buy coffee beans");
      expect(parsed.tags).toContain("groceries");
      expect(parsed.estimateMin).toBe(15);
      expect(parsed.recurrence?.rrule).toBe("FREQ=WEEKLY;INTERVAL=1");
    });
  });
});
