-- Phase 6 (Notifications) Day 1: additive schema changes.
-- NOTE: generated via `drizzle-kit generate` then trimmed to the Phase 6 delta only.
-- Prior migrations (0001-0005) were hand-written with --custom and did not update
-- snapshots, so the raw diff also contained already-applied statements. Only the
-- statements below are new relative to a database migrated through 0005.
CREATE TABLE `digest_log` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`local_date` text NOT NULL,
	`sent_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `local_date`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `email_suppressions` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `list_notification_rules` (
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	`mode` text DEFAULT 'all' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `list_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`device_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`not_before` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`lease_until` integer,
	`provider_id` text,
	`error_code` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `delivery_status_next_idx` ON `notification_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `delivery_notification_idx` ON `notification_deliveries` (`notification_id`);--> statement-breakpoint
CREATE TABLE `notification_prefs` (
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
	`weekly_day` integer DEFAULT 1 NOT NULL,
	`weekly_time` text DEFAULT '09:00' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scheduler_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `devices` ADD `push_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `push_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `push_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `last_push_at` integer;--> statement-breakpoint
ALTER TABLE `devices` ADD `push_endpoint_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `device_push_endpoint_hash_unique` ON `devices` (`push_endpoint_hash`);--> statement-breakpoint
ALTER TABLE `notifications` ADD `url` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `entity_type` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `entity_id` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `payload` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `priority` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `group_key` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `dedupe_key` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `read_at` integer;--> statement-breakpoint
ALTER TABLE `notifications` ADD `expires_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_dedupe_unique` ON `notifications` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
ALTER TABLE `reminders` ADD `outcome` text;--> statement-breakpoint
INSERT INTO `notification_prefs` (`user_id`, `created_at`, `updated_at`) SELECT `id`, strftime('%s','now') * 1000, strftime('%s','now') * 1000 FROM `user` WHERE `id` NOT IN (SELECT `user_id` FROM `notification_prefs`);
