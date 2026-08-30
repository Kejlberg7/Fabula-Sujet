CREATE TABLE `review_run` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_id` text NOT NULL,
	`scope_label` text NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	`summary` text
);
--> statement-breakpoint
CREATE INDEX `review_run_branch_idx` ON `review_run` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `review_scene` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`run_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`text_id` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `review_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_scene_run_idx` ON `review_scene` (`run_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_scene_unique` ON `review_scene` (`run_id`,`scene_id`);--> statement-breakpoint
ALTER TABLE `suggestion` ADD `run_id` text;--> statement-breakpoint
ALTER TABLE `suggestion` ADD `text_id` text;