-- En plottråd kan nu nå ud over den bog, den begyndte i.
--
-- Tilføjet frem for at bygge tabellen om: SQLite kan ikke slippe NOT NULL på
-- en kolonne uden at genskabe tabellen, og en genskabelse fejler ved commit,
-- fordi `beat`s fremmednøgle tæller de implicitte sletninger med og aldrig
-- tæller dem tilbage igen. Prøvet mod en kopi af den rigtige database.
--
-- `work_id` bliver stående og betyder nu den bog, tråden begynder i.
ALTER TABLE `thread` ADD COLUMN `scope` text DEFAULT 'work' NOT NULL;
