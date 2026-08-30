CREATE TABLE `story_reference` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`origin_id` text,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `world`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `story_reference_target_idx` ON `story_reference` (`branch_id`,`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `story_reference_world_idx` ON `story_reference` (`world_id`,`branch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_reference_code_unique` ON `story_reference` (`branch_id`,`code`);
--> statement-breakpoint
/*
 * Existing stories receive codes as part of the schema migration, not on the
 * next user edit. Rows copied into sibling branches share a lineage root and
 * therefore receive the same code. New rows are indexed by the change-log turn
 * that creates them.
 */
WITH RECURSIVE lineage(id, root_id) AS (
  SELECT id, id FROM entity e
  WHERE origin_id IS NULL OR NOT EXISTS (SELECT 1 FROM entity p WHERE p.id = e.origin_id)
  UNION ALL
  SELECT child.id, parent.root_id FROM entity child JOIN lineage parent ON child.origin_id = parent.id
), ranked AS (
  SELECT e.id AS target_id, e.world_id, e.branch_id,
    CASE e.kind WHEN 'person' THEN 'P' WHEN 'place' THEN 'S' WHEN 'object' THEN 'G'
      WHEN 'organisation' THEN 'O' ELSE 'B' END AS prefix,
    dense_rank() OVER (
      PARTITION BY e.world_id, e.kind ORDER BY lineage.root_id
    ) AS ordinal
  FROM entity e JOIN lineage ON lineage.id = e.id
)
INSERT INTO story_reference (id, world_id, branch_id, origin_id, target_kind, target_id, code, created_at)
SELECT lower(hex(randomblob(16))), world_id, branch_id, NULL, 'entity', target_id,
  prefix || ordinal, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM ranked;
--> statement-breakpoint
WITH RECURSIVE lineage(id, root_id) AS (
  SELECT id, id FROM identity x
  WHERE origin_id IS NULL OR NOT EXISTS (SELECT 1 FROM identity p WHERE p.id = x.origin_id)
  UNION ALL
  SELECT child.id, parent.root_id FROM identity child JOIN lineage parent ON child.origin_id = parent.id
), ranked AS (
  SELECT x.id AS target_id, b.world_id, x.branch_id,
    dense_rank() OVER (PARTITION BY b.world_id ORDER BY lineage.root_id) AS ordinal
  FROM identity x JOIN lineage ON lineage.id = x.id JOIN branch b ON b.id = x.branch_id
)
INSERT INTO story_reference (id, world_id, branch_id, origin_id, target_kind, target_id, code, created_at)
SELECT lower(hex(randomblob(16))), world_id, branch_id, NULL, 'identity', target_id,
  'I' || ordinal, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM ranked;
--> statement-breakpoint
WITH RECURSIVE lineage(id, root_id) AS (
  SELECT id, id FROM event x
  WHERE origin_id IS NULL OR NOT EXISTS (SELECT 1 FROM event p WHERE p.id = x.origin_id)
  UNION ALL
  SELECT child.id, parent.root_id FROM event child JOIN lineage parent ON child.origin_id = parent.id
), ranked AS (
  SELECT x.id AS target_id, x.world_id, x.branch_id,
    dense_rank() OVER (PARTITION BY x.world_id ORDER BY lineage.root_id) AS ordinal
  FROM event x JOIN lineage ON lineage.id = x.id
)
INSERT INTO story_reference (id, world_id, branch_id, origin_id, target_kind, target_id, code, created_at)
SELECT lower(hex(randomblob(16))), world_id, branch_id, NULL, 'event', target_id,
  'E' || ordinal, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM ranked;
--> statement-breakpoint
WITH RECURSIVE lineage(id, root_id) AS (
  SELECT id, id FROM fact x
  WHERE origin_id IS NULL OR NOT EXISTS (SELECT 1 FROM fact p WHERE p.id = x.origin_id)
  UNION ALL
  SELECT child.id, parent.root_id FROM fact child JOIN lineage parent ON child.origin_id = parent.id
), ranked AS (
  SELECT x.id AS target_id, x.world_id, x.branch_id,
    dense_rank() OVER (PARTITION BY x.world_id ORDER BY lineage.root_id) AS ordinal
  FROM fact x JOIN lineage ON lineage.id = x.id
)
INSERT INTO story_reference (id, world_id, branch_id, origin_id, target_kind, target_id, code, created_at)
SELECT lower(hex(randomblob(16))), world_id, branch_id, NULL, 'fact', target_id,
  'F' || ordinal, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM ranked;
--> statement-breakpoint
WITH RECURSIVE lineage(id, root_id) AS (
  SELECT id, id FROM reveal x
  WHERE origin_id IS NULL OR NOT EXISTS (SELECT 1 FROM reveal p WHERE p.id = x.origin_id)
  UNION ALL
  SELECT child.id, parent.root_id FROM reveal child JOIN lineage parent ON child.origin_id = parent.id
), ranked AS (
  SELECT x.id AS target_id, b.world_id, x.branch_id,
    dense_rank() OVER (PARTITION BY b.world_id ORDER BY lineage.root_id) AS ordinal
  FROM reveal x JOIN lineage ON lineage.id = x.id JOIN branch b ON b.id = x.branch_id
)
INSERT INTO story_reference (id, world_id, branch_id, origin_id, target_kind, target_id, code, created_at)
SELECT lower(hex(randomblob(16))), world_id, branch_id, NULL, 'reveal', target_id,
  'A' || ordinal, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM ranked;
--> statement-breakpoint
WITH RECURSIVE lineage(id, root_id) AS (
  SELECT id, id FROM scene x
  WHERE origin_id IS NULL OR NOT EXISTS (SELECT 1 FROM scene p WHERE p.id = x.origin_id)
  UNION ALL
  SELECT child.id, parent.root_id FROM scene child JOIN lineage parent ON child.origin_id = parent.id
), ranked AS (
  SELECT x.id AS target_id, b.world_id, x.branch_id,
    dense_rank() OVER (PARTITION BY b.world_id ORDER BY lineage.root_id) AS ordinal
  FROM scene x JOIN lineage ON lineage.id = x.id JOIN branch b ON b.id = x.branch_id
)
INSERT INTO story_reference (id, world_id, branch_id, origin_id, target_kind, target_id, code, created_at)
SELECT lower(hex(randomblob(16))), world_id, branch_id, NULL, 'scene', target_id,
  'SC' || ordinal, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM ranked;
--> statement-breakpoint
WITH RECURSIVE lineage(id, root_id) AS (
  SELECT id, id FROM thread x
  WHERE origin_id IS NULL OR NOT EXISTS (SELECT 1 FROM thread p WHERE p.id = x.origin_id)
  UNION ALL
  SELECT child.id, parent.root_id FROM thread child JOIN lineage parent ON child.origin_id = parent.id
), ranked AS (
  SELECT x.id AS target_id, b.world_id, x.branch_id,
    dense_rank() OVER (PARTITION BY b.world_id ORDER BY lineage.root_id) AS ordinal
  FROM thread x JOIN lineage ON lineage.id = x.id JOIN branch b ON b.id = x.branch_id
)
INSERT INTO story_reference (id, world_id, branch_id, origin_id, target_kind, target_id, code, created_at)
SELECT lower(hex(randomblob(16))), world_id, branch_id, NULL, 'thread', target_id,
  'T' || ordinal, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM ranked;
