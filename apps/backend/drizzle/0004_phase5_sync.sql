CREATE TABLE `sync_state` (
	`seq` integer NOT NULL DEFAULT 0,
	`min_valid_seq` integer NOT NULL DEFAULT 0,
	`epoch` text NOT NULL,
	`min_client_version` text
);
--> statement-breakpoint
CREATE TABLE `processed_mutations` (
	`user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
	`id` text NOT NULL,
	`device_id` text,
	`status` text NOT NULL,
	`result` text,
	`created_at` integer,
	PRIMARY KEY (`user_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `sync_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`losing_value` text,
	`winning_value` text,
	`at` integer
);
--> statement-breakpoint
ALTER TABLE `user` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `user` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `folders` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `folders` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `lists` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `lists` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `sections` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `sections` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `recurrences` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `recurrences` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `places` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `places` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `checklist_items` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `checklist_items` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `tags` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `tags` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `templates` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `templates` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `reminders` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `reminders` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `saved_filters` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `saved_filters` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `time_blocks` ADD COLUMN `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `time_blocks` ADD COLUMN `field_ts` text;
--> statement-breakpoint
ALTER TABLE `devices` ADD COLUMN `last_sync_seq` integer;
--> statement-breakpoint
ALTER TABLE `devices` ADD COLUMN `last_sync_at` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_seq_idx` ON `user` (`id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `folder_user_seq_idx` ON `folders` (`user_id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `list_user_seq_idx` ON `lists` (`user_id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `section_user_seq_idx` ON `sections` (`user_id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `recurrence_user_seq_idx` ON `recurrences` (`user_id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `place_user_seq_idx` ON `places` (`user_id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `task_user_seq_idx` ON `tasks` (`user_id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `checklist_user_seq_idx` ON `checklist_items` (`user_id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tag_user_seq_idx` ON `tags` (`user_id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `template_user_seq_idx` ON `templates` (`user_id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reminder_user_seq_idx` ON `reminders` (`user_id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `saved_filters_user_seq_idx` ON `saved_filters` (`user_id`,`seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `time_blocks_user_seq_idx` ON `time_blocks` (`user_id`,`seq`);
--> statement-breakpoint
CREATE TEMP TABLE `_backfill` (`rn` INTEGER PRIMARY KEY AUTOINCREMENT, `tbl` TEXT NOT NULL, `pk` TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'user', `id` FROM `user`;
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'folders', `id` FROM `folders`;
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'lists', `id` FROM `lists`;
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'sections', `id` FROM `sections`;
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'recurrences', `id` FROM `recurrences`;
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'places', `id` FROM `places`;
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'tasks', `id` FROM `tasks`;
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'checklist_items', `id` FROM `checklist_items`;
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'tags', `id` FROM `tags`;
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'templates', `id` FROM `templates`;
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'reminders', `id` FROM `reminders`;
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'saved_filters', `id` FROM `saved_filters`;
--> statement-breakpoint
INSERT INTO `_backfill` (`tbl`, `pk`) SELECT 'time_blocks', `id` FROM `time_blocks`;
--> statement-breakpoint
UPDATE `user` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'user' AND `b`.`pk` = `user`.`id`);
--> statement-breakpoint
UPDATE `folders` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'folders' AND `b`.`pk` = `folders`.`id`);
--> statement-breakpoint
UPDATE `lists` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'lists' AND `b`.`pk` = `lists`.`id`);
--> statement-breakpoint
UPDATE `sections` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'sections' AND `b`.`pk` = `sections`.`id`);
--> statement-breakpoint
UPDATE `recurrences` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'recurrences' AND `b`.`pk` = `recurrences`.`id`);
--> statement-breakpoint
UPDATE `places` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'places' AND `b`.`pk` = `places`.`id`);
--> statement-breakpoint
UPDATE `tasks` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'tasks' AND `b`.`pk` = `tasks`.`id`);
--> statement-breakpoint
UPDATE `checklist_items` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'checklist_items' AND `b`.`pk` = `checklist_items`.`id`);
--> statement-breakpoint
UPDATE `tags` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'tags' AND `b`.`pk` = `tags`.`id`);
--> statement-breakpoint
UPDATE `templates` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'templates' AND `b`.`pk` = `templates`.`id`);
--> statement-breakpoint
UPDATE `reminders` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'reminders' AND `b`.`pk` = `reminders`.`id`);
--> statement-breakpoint
UPDATE `saved_filters` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'saved_filters' AND `b`.`pk` = `saved_filters`.`id`);
--> statement-breakpoint
UPDATE `time_blocks` SET `seq` = (SELECT `rn` FROM `_backfill` `b` WHERE `b`.`tbl` = 'time_blocks' AND `b`.`pk` = `time_blocks`.`id`);
--> statement-breakpoint
DROP TABLE `_backfill`;
--> statement-breakpoint
INSERT INTO `sync_state` (`seq`, `min_valid_seq`, `epoch`, `min_client_version`)
VALUES (
  COALESCE((SELECT MAX(`seq`) FROM (
    SELECT `seq` FROM `user` UNION ALL
    SELECT `seq` FROM `folders` UNION ALL
    SELECT `seq` FROM `lists` UNION ALL
    SELECT `seq` FROM `sections` UNION ALL
    SELECT `seq` FROM `recurrences` UNION ALL
    SELECT `seq` FROM `places` UNION ALL
    SELECT `seq` FROM `tasks` UNION ALL
    SELECT `seq` FROM `checklist_items` UNION ALL
    SELECT `seq` FROM `tags` UNION ALL
    SELECT `seq` FROM `templates` UNION ALL
    SELECT `seq` FROM `reminders` UNION ALL
    SELECT `seq` FROM `saved_filters` UNION ALL
    SELECT `seq` FROM `time_blocks`
  )), 0),
  0,
  hex(randomblob(16)),
  '1.0.0'
);
--> statement-breakpoint
CREATE TRIGGER `user_sync_insert` AFTER INSERT ON `user` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `user` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `user_sync_update` AFTER UPDATE ON `user` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `user` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `folders_sync_insert` AFTER INSERT ON `folders` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `folders` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `folders_sync_update` AFTER UPDATE ON `folders` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `folders` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `lists_sync_insert` AFTER INSERT ON `lists` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `lists` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `lists_sync_update` AFTER UPDATE ON `lists` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `lists` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `sections_sync_insert` AFTER INSERT ON `sections` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `sections` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `sections_sync_update` AFTER UPDATE ON `sections` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `sections` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `recurrences_sync_insert` AFTER INSERT ON `recurrences` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `recurrences` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `recurrences_sync_update` AFTER UPDATE ON `recurrences` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `recurrences` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `places_sync_insert` AFTER INSERT ON `places` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `places` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `places_sync_update` AFTER UPDATE ON `places` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `places` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `tasks_sync_insert` AFTER INSERT ON `tasks` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `tasks` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `tasks_sync_update` AFTER UPDATE ON `tasks` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `tasks` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `checklist_items_sync_insert` AFTER INSERT ON `checklist_items` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `checklist_items` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `checklist_items_sync_update` AFTER UPDATE ON `checklist_items` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `checklist_items` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `tags_sync_insert` AFTER INSERT ON `tags` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `tags` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `tags_sync_update` AFTER UPDATE ON `tags` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `tags` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `templates_sync_insert` AFTER INSERT ON `templates` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `templates` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `templates_sync_update` AFTER UPDATE ON `templates` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `templates` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `reminders_sync_insert` AFTER INSERT ON `reminders` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `reminders` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `reminders_sync_update` AFTER UPDATE ON `reminders` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `reminders` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `saved_filters_sync_insert` AFTER INSERT ON `saved_filters` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `saved_filters` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `saved_filters_sync_update` AFTER UPDATE ON `saved_filters` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `saved_filters` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `time_blocks_sync_insert` AFTER INSERT ON `time_blocks` WHEN NEW.`seq` = 0 BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `time_blocks` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `time_blocks_sync_update` AFTER UPDATE ON `time_blocks` WHEN NEW.`seq` = OLD.`seq` BEGIN
  UPDATE `sync_state` SET `seq` = `seq` + 1;
  UPDATE `time_blocks` SET `seq` = (SELECT `seq` FROM `sync_state`) WHERE `id` = NEW.`id`;
END;
