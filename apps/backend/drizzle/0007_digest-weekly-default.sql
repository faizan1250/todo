-- Phase 6 (Notifications) Day 5: weekly digest default becomes Sunday 17:00.
-- SQLite cannot ALTER a column default, so the table is rebuilt. Data is
-- preserved; rows still holding the previous defaults (Mon 09:00, i.e. never
-- explicitly chosen) move to the new default.
CREATE TABLE `__new_notification_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`types` text DEFAULT '{}' NOT NULL,
	`quiet_enabled` integer DEFAULT false NOT NULL,
	`quiet_start` text DEFAULT '22:00' NOT NULL,
	`quiet_end` text DEFAULT '07:00' NOT NULL,
	`urgent_breaks_quiet` integer DEFAULT false NOT NULL,
	`paused_until` integer,
	`hide_content` integer DEFAULT false NOT NULL,
	`digest_daily_enabled` integer DEFAULT false NOT NULL,
	`digest_time` text DEFAULT '08:00' NOT NULL,
	`weekly_enabled` integer DEFAULT false NOT NULL,
	`weekly_day` integer DEFAULT 0 NOT NULL,
	`weekly_time` text DEFAULT '17:00' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_notification_prefs` (`user_id`, `types`, `quiet_enabled`, `quiet_start`, `quiet_end`, `urgent_breaks_quiet`, `paused_until`, `hide_content`, `digest_daily_enabled`, `digest_time`, `weekly_enabled`, `weekly_day`, `weekly_time`, `created_at`, `updated_at`) SELECT `user_id`, `types`, `quiet_enabled`, `quiet_start`, `quiet_end`, `urgent_breaks_quiet`, `paused_until`, `hide_content`, `digest_daily_enabled`, `digest_time`, `weekly_enabled`, `weekly_day`, `weekly_time`, `created_at`, `updated_at` FROM `notification_prefs`;
--> statement-breakpoint
DROP TABLE `notification_prefs`;
--> statement-breakpoint
ALTER TABLE `__new_notification_prefs` RENAME TO `notification_prefs`;
--> statement-breakpoint
UPDATE `notification_prefs` SET `weekly_day` = 0, `weekly_time` = '17:00' WHERE `weekly_day` = 1 AND `weekly_time` = '09:00';
