CREATE TABLE `memory_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`entity_id` text NOT NULL,
	`leg_id` text,
	`from_personal` integer,
	`until_personal` integer,
	`retention_seconds` integer,
	`note` text,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`leg_id`) REFERENCES `entity_leg`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memory_policy_entity_idx` ON `memory_policy` (`entity_id`,`branch_id`);
