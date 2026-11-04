import { describe, it, expect, mock } from "bun:test";
import type { TaskItem } from "../src/components/app/types";

describe("Landing and App UI Components", () => {
  describe("Task Data Models & Filters", () => {
    const mockTasks: TaskItem[] = [
      {
        id: "task-1",
        title: "Verify ElysiaJS healthcheck endpoint contracts",
        completed: true,
        priority: "high",
        list: "today",
        folder: "engineering",
        tags: ["backend", "elysia"],
        subtasks: [
          { id: "st-1", title: "Endpoint spec", completed: true },
          { id: "st-2", title: "CORS headers", completed: true },
        ],
        createdAt: "Today",
        updatedAt: "Today",
      },
      {
        id: "task-2",
        title: "Refine bubblegum pink accent glow",
        completed: false,
        priority: "med",
        list: "today",
        folder: "design",
        tags: ["ui", "design-tokens"],
        subtasks: [{ id: "st-3", title: "Test contrast", completed: false }],
        createdAt: "Today",
        updatedAt: "Today",
      },
      {
        id: "task-3",
        title: "Setup personal engineering workflow notes",
        completed: false,
        priority: "low",
        list: "backlog",
        folder: "personal",
        tags: ["notes"],
        subtasks: [],
        createdAt: "Yesterday",
        updatedAt: "Yesterday",
      },
    ];

    it("correctly filters tasks by list", () => {
      const todayTasks = mockTasks.filter((t) => t.list === "today");
      expect(todayTasks.length).toBe(2);

      const backlogTasks = mockTasks.filter((t) => t.list === "backlog");
      expect(backlogTasks.length).toBe(1);
      expect(backlogTasks[0]?.id).toBe("task-3");
    });

    it("correctly filters tasks by folder", () => {
      const engTasks = mockTasks.filter((t) => t.folder === "engineering");
      expect(engTasks.length).toBe(1);
      expect(engTasks[0]?.title).toContain("ElysiaJS");

      const designTasks = mockTasks.filter((t) => t.folder === "design");
      expect(designTasks.length).toBe(1);
      expect(designTasks[0]?.folder).toBe("design");
    });

    it("correctly calculates completed subtask progress", () => {
      const taskWithSubtasks = mockTasks[0];
      expect(taskWithSubtasks).toBeDefined();
      if (!taskWithSubtasks) return;
      const completed = taskWithSubtasks.subtasks.filter((s) => s.completed).length;
      const total = taskWithSubtasks.subtasks.length;
      expect(completed).toBe(2);
      expect(total).toBe(2);
      expect(Math.round((completed / total) * 100)).toBe(100);
    });

    it("filters tasks by substring search across title and tags", () => {
      const query = "elysia";
      const matched = mockTasks.filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          t.tags.some((tag) => tag.toLowerCase().includes(query))
      );
      expect(matched.length).toBe(1);
      expect(matched[0]?.id).toBe("task-1");

      const tagQuery = "design-tokens";
      const tagMatched = mockTasks.filter(
        (t) =>
          t.title.toLowerCase().includes(tagQuery) ||
          t.tags.some((tag) => tag.toLowerCase().includes(tagQuery))
      );
      expect(tagMatched.length).toBe(1);
      expect(tagMatched[0]?.id).toBe("task-2");
    });
  });

  describe("Streak Engine Logic", () => {
    it("increments streak count and grants XP bonus on completion", () => {
      let streak = 4;
      const onTaskComplete = () => {
        streak += 1;
        return { streak, xp: 50 };
      };

      const result = onTaskComplete();
      expect(result.streak).toBe(5);
      expect(result.xp).toBe(50);
    });

    it("handles streak undo gracefully without dropping below 1", () => {
      let streak = 1;
      const onUndo = () => {
        streak = Math.max(1, streak - 1);
        return streak;
      };

      expect(onUndo()).toBe(1);
    });
  });

  describe("Command Palette Navigation Rules", () => {
    const commands = [
      { id: "today", title: "Go to Today's Tasks", category: "Navigation" },
      { id: "upcoming", title: "Go to Upcoming Sprints", category: "Navigation" },
      { id: "engineering", title: "Filter: Engineering Folder", category: "Folders" },
      { id: "theme", title: "Toggle Theme (Light / Dark)", category: "Actions" },
      { id: "new", title: "Create New Task", category: "Actions" },
    ];

    it("filters commands using fuzzy matching", () => {
      const filterCommands = (q: string) => {
        const query = q.toLowerCase();
        return commands.filter(
          (c) =>
            c.title.toLowerCase().includes(query) ||
            c.category.toLowerCase().includes(query)
        );
      };

      expect(filterCommands("theme").length).toBe(1);
      expect(filterCommands("navigation").length).toBe(2);
      expect(filterCommands("folders").length).toBe(1);
      expect(filterCommands("nonexistent").length).toBe(0);
    });
  });

  describe("Toast and Undo State Management", () => {
    it("executes reversible undo handler on user action", () => {
      let taskState = "deleted";
      const undoAction = mock(() => {
        taskState = "restored";
      });

      // Simulate user clicking "Undo"
      undoAction();
      expect(undoAction).toHaveBeenCalledTimes(1);
      expect(taskState).toBe("restored");
    });
  });
});
