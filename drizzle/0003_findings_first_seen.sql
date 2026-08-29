-- `finding.first_seen_at` hed `created_at`, fordi feltet brugte den fælles
-- createdAt()-hjælper, der altid navngiver sin kolonne sådan. Tabellen er
-- skrevet med rå SQL, så feltnavn og kolonnenavn skal stemme overens.
-- Tabellen er aldrig blevet skrevet til, så den bygges bare om.
DROP TABLE IF EXISTS `finding`;--> statement-breakpoint
CREATE TABLE `finding` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`rule_code` text NOT NULL,
	`severity` text NOT NULL,
	`fingerprint` text NOT NULL,
	`message` text NOT NULL,
	`subjects` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `finding_branch_idx` ON `finding` (`branch_id`,`rule_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `finding_fingerprint_unique` ON `finding` (`branch_id`,`fingerprint`);
