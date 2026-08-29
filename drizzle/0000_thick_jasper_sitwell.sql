CREATE TABLE `place_link` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`realm_id` text NOT NULL,
	`from_place_id` text NOT NULL,
	`to_place_id` text NOT NULL,
	`mode` text NOT NULL,
	`travel_min` integer,
	`travel_max` integer,
	`bidirectional` integer DEFAULT true NOT NULL,
	`note` text,
	FOREIGN KEY (`realm_id`) REFERENCES `realm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `place_link_from_idx` ON `place_link` (`from_place_id`,`branch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `place_link_unique` ON `place_link` (`from_place_id`,`to_place_id`,`mode`,`branch_id`);--> statement-breakpoint
CREATE TABLE `realm` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`parent_realm_id` text,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`time_system_id` text NOT NULL,
	`time_ratio_num` integer DEFAULT 1 NOT NULL,
	`time_ratio_den` integer DEFAULT 1 NOT NULL,
	`entry_event_id` text,
	`exit_event_id` text,
	`summary` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `world`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`time_system_id`) REFERENCES `time_system`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `realm_world_idx` ON `realm` (`world_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`name` text NOT NULL,
	`summary` text,
	`position` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `world`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `time_system` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'gregorian' NOT NULL,
	`config` text,
	FOREIGN KEY (`world_id`) REFERENCES `world`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `world` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entity` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`summary` text,
	`description` text,
	`born_event_id` text,
	`died_event_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `world`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entity_world_idx` ON `entity` (`world_id`,`branch_id`,`kind`);--> statement-breakpoint
CREATE TABLE `entity_leg` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`ordinal` integer NOT NULL,
	`label` text,
	`personal_start` integer,
	`personal_end` integer,
	`world_start` integer,
	`world_end` integer,
	`realm_id` text,
	`identity_id` text,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`realm_id`) REFERENCES `realm`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`identity_id`) REFERENCES `identity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `leg_entity_idx` ON `entity_leg` (`entity_id`,`branch_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `identity` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`name` text NOT NULL,
	`same_as_fact_id` text,
	`note` text,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `possession` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`holder_entity_id` text NOT NULL,
	`holder_leg_id` text,
	`object_entity_id` text NOT NULL,
	`from_time` integer,
	`to_time` integer,
	`note` text,
	FOREIGN KEY (`holder_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`holder_leg_id`) REFERENCES `entity_leg`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`object_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `possession_holder_idx` ON `possession` (`holder_entity_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `possession_object_idx` ON `possession` (`object_entity_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `presence` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`entity_id` text NOT NULL,
	`leg_id` text,
	`place_id` text NOT NULL,
	`realm_id` text NOT NULL,
	`from_time` integer,
	`to_time` integer,
	`derived_from_event_id` text,
	`note` text,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`leg_id`) REFERENCES `entity_leg`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`place_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`realm_id`) REFERENCES `realm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `presence_entity_idx` ON `presence` (`entity_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `presence_place_idx` ON `presence` (`place_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `relationship` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`from_entity_id` text NOT NULL,
	`to_entity_id` text NOT NULL,
	`kind` text NOT NULL,
	`symmetric` integer DEFAULT false NOT NULL,
	`from_time` integer,
	`to_time` integer,
	`note` text,
	FOREIGN KEY (`from_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `relationship_from_idx` ON `relationship` (`from_entity_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`realm_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`title` text NOT NULL,
	`summary` text,
	`place_id` text,
	`earliest` integer,
	`latest` integer,
	`duration_min` integer,
	`duration_max` integer,
	`precision` text DEFAULT 'unknown' NOT NULL,
	`solved_earliest` integer,
	`solved_latest` integer,
	`solved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `world`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`realm_id`) REFERENCES `realm`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`place_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_world_idx` ON `event` (`world_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `event_realm_idx` ON `event` (`realm_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `participation` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`event_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`leg_id` text,
	`role` text NOT NULL,
	`absorbs_knowledge` integer,
	`note` text,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`leg_id`) REFERENCES `entity_leg`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `participation_event_idx` ON `participation` (`event_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `participation_entity_idx` ON `participation` (`entity_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `temporal_link` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`from_event_id` text NOT NULL,
	`to_event_id` text NOT NULL,
	`kind` text NOT NULL,
	`offset_min` integer,
	`offset_max` integer,
	`axis` text DEFAULT 'world' NOT NULL,
	`leg_id` text,
	`note` text,
	FOREIGN KEY (`from_event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`leg_id`) REFERENCES `entity_leg`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `temporal_link_from_idx` ON `temporal_link` (`from_event_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `temporal_link_to_idx` ON `temporal_link` (`to_event_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `belief` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`entity_id` text NOT NULL,
	`leg_id` text,
	`fact_id` text NOT NULL,
	`strength` text NOT NULL,
	`since_personal` integer,
	`until_personal` integer,
	`source_event_id` text,
	`source_statement_id` text,
	`source_carrier_id` text,
	`derived` integer DEFAULT false NOT NULL,
	`note` text,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`leg_id`) REFERENCES `entity_leg`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fact_id`) REFERENCES `fact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `belief_entity_idx` ON `belief` (`entity_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `belief_fact_idx` ON `belief` (`fact_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `binding` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`slot_id` text NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`value_entity_id` text,
	`value_time` integer,
	`value_text` text,
	`value_number` integer,
	FOREIGN KEY (`slot_id`) REFERENCES `fact_slot`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`value_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `binding_owner_idx` ON `binding` (`owner_kind`,`owner_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `binding_slot_idx` ON `binding` (`slot_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `carrier` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`object_entity_id` text NOT NULL,
	`fact_id` text NOT NULL,
	`accurate` integer DEFAULT true NOT NULL,
	`written_event_id` text,
	`destroyed_event_id` text,
	`note` text,
	FOREIGN KEY (`object_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fact_id`) REFERENCES `fact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`written_event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destroyed_event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `carrier_object_idx` ON `carrier` (`object_entity_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `fact` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`realm_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`predicate` text NOT NULL,
	`summary` text NOT NULL,
	`truth` text DEFAULT 'true' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `world`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`realm_id`) REFERENCES `realm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fact_world_idx` ON `fact` (`world_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `fact_slot` (
	`id` text PRIMARY KEY NOT NULL,
	`fact_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`value_kind` text NOT NULL,
	FOREIGN KEY (`fact_id`) REFERENCES `fact`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fact_slot_unique` ON `fact_slot` (`fact_id`,`name`,`branch_id`);--> statement-breakpoint
CREATE TABLE `statement` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`event_id` text,
	`speaker_entity_id` text NOT NULL,
	`speaker_leg_id` text,
	`fact_id` text NOT NULL,
	`truthful` integer,
	`audience_entity_id` text,
	`at_time` integer,
	`note` text,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`speaker_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`speaker_leg_id`) REFERENCES `entity_leg`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fact_id`) REFERENCES `fact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`audience_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `statement_speaker_idx` ON `statement` (`speaker_entity_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `law` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`kind` text NOT NULL,
	`hardness` text NOT NULL,
	`rule_code` text,
	`scope_kind` text NOT NULL,
	`scope_id` text,
	`subject_kind` text DEFAULT 'everyone' NOT NULL,
	`subject_entity_id` text,
	`subject_expression` text,
	`statement` text NOT NULL,
	`valid_from` integer,
	`valid_to` integer,
	`source_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `world`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `law_world_idx` ON `law` (`world_id`,`branch_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `law_rule_idx` ON `law` (`rule_code`,`branch_id`);--> statement-breakpoint
CREATE TABLE `source` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`file_path` text,
	`mime_type` text,
	`byte_size` integer,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `world`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `source_world_idx` ON `source` (`world_id`);--> statement-breakpoint
CREATE TABLE `source_link` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`quote` text,
	`note` text,
	FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `source_link_target_idx` ON `source_link` (`target_kind`,`target_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `beat` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`scene_id` text,
	`kind` text NOT NULL,
	`summary` text,
	`position` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scene_id`) REFERENCES `scene`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `beat_thread_idx` ON `beat` (`thread_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `branch` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`parent_branch_id` text,
	`fork_change_seq` integer,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `world`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `branch_world_idx` ON `branch` (`world_id`);--> statement-breakpoint
CREATE TABLE `chapter` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`part_id` text,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`summary` text,
	FOREIGN KEY (`work_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`part_id`) REFERENCES `part`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chapter_work_idx` ON `chapter` (`work_id`,`branch_id`,`position`);--> statement-breakpoint
CREATE TABLE `part` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reveal` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`fact_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`slot_id` text,
	`strength` text DEFAULT 'stated' NOT NULL,
	`note` text,
	FOREIGN KEY (`fact_id`) REFERENCES `fact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scene_id`) REFERENCES `scene`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reveal_scene_idx` ON `reveal` (`scene_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `reveal_fact_idx` ON `reveal` (`fact_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `scene` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`title` text,
	`position` integer NOT NULL,
	`pov_entity_id` text,
	`pov_leg_id` text,
	`narration_person` text,
	`narration_tense` text,
	`realm_id` text,
	`summary` text,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pov_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pov_leg_id`) REFERENCES `entity_leg`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`realm_id`) REFERENCES `realm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scene_chapter_idx` ON `scene` (`chapter_id`,`branch_id`,`position`);--> statement-breakpoint
CREATE TABLE `scene_event` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`scene_id` text NOT NULL,
	`event_id` text NOT NULL,
	`mode` text NOT NULL,
	`note` text,
	FOREIGN KEY (`scene_id`) REFERENCES `scene`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scene_event_scene_idx` ON `scene_event` (`scene_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `scene_event_event_idx` ON `scene_event` (`event_id`,`branch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `scene_event_unique` ON `scene_event` (`scene_id`,`event_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `scene_text` (
	`id` text PRIMARY KEY NOT NULL,
	`scene_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`doc` text NOT NULL,
	`markdown` text,
	`word_count` integer,
	`is_current` integer DEFAULT true NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scene`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scene_text_scene_idx` ON `scene_text` (`scene_id`,`branch_id`,`is_current`);--> statement-breakpoint
CREATE TABLE `text_anchor` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`scene_id` text NOT NULL,
	`mark_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`excerpt` text,
	FOREIGN KEY (`scene_id`) REFERENCES `scene`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `text_anchor_scene_idx` ON `text_anchor` (`scene_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `text_anchor_target_idx` ON `text_anchor` (`target_kind`,`target_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `thread` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`name` text NOT NULL,
	`summary` text,
	FOREIGN KEY (`work_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `work` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`series_id` text,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`title` text NOT NULL,
	`summary` text,
	`position` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `world`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `work_world_idx` ON `work` (`world_id`,`branch_id`);--> statement-breakpoint
CREATE TABLE `app_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `change` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`branch_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`op` text NOT NULL,
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`before` text,
	`after` text,
	`created_at` integer NOT NULL,
	`undone_at` integer,
	FOREIGN KEY (`turn_id`) REFERENCES `turn`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `change_seq_idx` ON `change` (`branch_id`,`seq`);--> statement-breakpoint
CREATE INDEX `change_row_idx` ON `change` (`table_name`,`row_id`);--> statement-breakpoint
CREATE INDEX `change_turn_idx` ON `change` (`turn_id`);--> statement-breakpoint
CREATE TABLE `checkpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`change_seq` integer NOT NULL,
	`label` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `checkpoint_branch_idx` ON `checkpoint` (`branch_id`,`change_seq`);--> statement-breakpoint
CREATE TABLE `turn` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_user_id` text,
	`summary` text,
	`prompt` text,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	`undone_at` integer,
	FOREIGN KEY (`actor_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `turn_branch_idx` ON `turn` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `dismissal` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dismissal_fingerprint_unique` ON `dismissal` (`branch_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `finding` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`rule_code` text NOT NULL,
	`severity` text NOT NULL,
	`fingerprint` text NOT NULL,
	`message` text NOT NULL,
	`subjects` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `finding_branch_idx` ON `finding` (`branch_id`,`rule_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `finding_fingerprint_unique` ON `finding` (`branch_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `suggestion` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`mark_id` text,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`proposed_text` text,
	`source_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE INDEX `suggestion_scene_idx` ON `suggestion` (`scene_id`,`branch_id`,`status`);