CREATE TABLE `saved_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`query` text NOT NULL,
	`sort` text,
	`group_by` text,
	`position` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_filters_user_pos_idx` ON `saved_filters` (`user_id`,`position`);
--> statement-breakpoint
CREATE TABLE `time_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	`user_id` text NOT NULL,
	`task_id` text,
	`title` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`color` text,
	CHECK (`end_at` > `start_at`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `time_blocks_user_start_idx` ON `time_blocks` (`user_id`,`start_at`);
--> statement-breakpoint
CREATE INDEX `task_active_user_due_idx` ON `tasks` (`user_id`,`due_at`) WHERE deleted_at IS NULL AND archived_at IS NULL AND status IN ('todo', 'in_progress');
--> statement-breakpoint
CREATE INDEX `task_active_user_priority_idx` ON `tasks` (`user_id`,`priority`) WHERE deleted_at IS NULL AND archived_at IS NULL AND status IN ('todo', 'in_progress');
--> statement-breakpoint
CREATE INDEX `task_done_user_completed_idx` ON `tasks` (`user_id`,`completed_at`) WHERE deleted_at IS NULL AND archived_at IS NULL AND status = 'done';
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  title, notes, content='tasks', content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, notes) VALUES (new.rowid, new.title, COALESCE(new.notes, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, notes) VALUES ('delete', old.rowid, old.title, COALESCE(old.notes, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE OF title, notes ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, notes) VALUES ('delete', old.rowid, old.title, COALESCE(old.notes, ''));
  INSERT INTO tasks_fts(rowid, title, notes) VALUES (new.rowid, new.title, COALESCE(new.notes, ''));
END;
--> statement-breakpoint
INSERT INTO tasks_fts(rowid, title, notes) SELECT rowid, title, COALESCE(notes, '') FROM tasks;
