CREATE TABLE `event_fact` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`event_id` text NOT NULL,
	`fact_id` text NOT NULL,
	`exposes` text DEFAULT 'reveals' NOT NULL,
	`slot_ids` text,
	`note` text,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_fact_event_idx` ON `event_fact` (`event_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `event_fact_fact_idx` ON `event_fact` (`fact_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `app_state` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`active_world_id` text,
	`active_work_id` text,
	`active_branch_id` text,
	`active_user_id` text,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `current_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `turn` ADD `kind` text DEFAULT 'edit' NOT NULL;--> statement-breakpoint
ALTER TABLE `turn` ADD `undoes_turn_id` text;