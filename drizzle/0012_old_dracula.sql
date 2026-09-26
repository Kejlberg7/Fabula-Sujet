ALTER TABLE `text_anchor` ADD `related_entity_id` text REFERENCES entity(id);--> statement-breakpoint
ALTER TABLE `text_anchor` ADD `state_category` text;--> statement-breakpoint
ALTER TABLE `text_anchor` ADD `state_value` text;