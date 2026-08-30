CREATE TABLE `disappearance` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`entity_id` text NOT NULL,
	`disappears_event_id` text NOT NULL,
	`returns_event_id` text,
	`note` text,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `disappearance_entity_idx` ON `disappearance` (`entity_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `entity_state` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`entity_id` text NOT NULL,
	`category` text NOT NULL,
	`value` text NOT NULL,
	`from_time` integer,
	`to_time` integer,
	`note` text,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entity_state_entity_idx` ON `entity_state` (`entity_id`,`branch_id`,`category`);--> statement-breakpoint
ALTER TABLE `identity` ADD `valid_from` integer;--> statement-breakpoint
ALTER TABLE `identity` ADD `valid_to` integer;--> statement-breakpoint
ALTER TABLE `relationship` ADD `category` text;--> statement-breakpoint
ALTER TABLE `participation` ADD `identity_id` text REFERENCES identity(id);--> statement-breakpoint
ALTER TABLE `source_link` ADD `relation` text DEFAULT 'context' NOT NULL;