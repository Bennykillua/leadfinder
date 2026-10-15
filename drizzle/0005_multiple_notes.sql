CREATE TABLE `note` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`lead_id`) REFERENCES `lead`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_user_lead` ON `note` (`user_id`,`lead_id`);--> statement-breakpoint
-- Keep each lead's old single note as its first note.
INSERT INTO `note` (`id`, `user_id`, `lead_id`, `body`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `user_id`, `id`, `notes`, `created_at`, `created_at` FROM `lead` WHERE trim(`notes`) <> '';--> statement-breakpoint
ALTER TABLE `lead` DROP COLUMN `notes`;