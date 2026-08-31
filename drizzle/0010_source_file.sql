-- Kilden husker nu, hvad filen hed, og hvordan den så ud.
--
-- Kontrolsummen er alt, hvad programmet ved om indholdet. Den kan sige «de her
-- bytes er ikke længere dem, du lagde ind», og ikke andet. Ingen fil bliver
-- læst, udtrukket eller fortolket.
ALTER TABLE `source` ADD COLUMN `original_name` text;--> statement-breakpoint
ALTER TABLE `source` ADD COLUMN `checksum` text;
