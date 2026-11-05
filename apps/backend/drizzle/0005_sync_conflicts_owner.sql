CREATE TABLE `__new_sync_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`losing_value` text,
	`winning_value` text,
	`at` integer,
	`user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
	`device_id` text
);
--> statement-breakpoint
INSERT INTO `__new_sync_conflicts` (`id`, `entity`, `entity_id`, `field`, `losing_value`, `winning_value`, `at`, `user_id`, `device_id`) SELECT `id`, `entity`, `entity_id`, `field`, `losing_value`, `winning_value`, `at`, '', NULL FROM `sync_conflicts`;
--> statement-breakpoint
DROP TABLE `sync_conflicts`;
--> statement-breakpoint
ALTER TABLE `__new_sync_conflicts` RENAME TO `sync_conflicts`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sync_conflicts_user_at_idx` ON `sync_conflicts` (`user_id`,`at`);
