DROP INDEX `tag_user_name_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `tags_user_name_unique` ON `tags` (`user_id`,"name" COLLATE NOCASE) WHERE deleted_at IS NULL;--> statement-breakpoint
DROP INDEX `task_parent_idx`;--> statement-breakpoint
CREATE INDEX `task_parent_idx` ON `tasks` (`parent_id`,`position`);