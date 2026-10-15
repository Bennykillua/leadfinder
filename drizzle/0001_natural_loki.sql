CREATE TABLE `serp_cache` (
	`query_key` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`response` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `serp_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`engine` text NOT NULL,
	`query` text NOT NULL,
	`ok` integer NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `serp_usage_at` ON `serp_usage` (`at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_lead` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`area` text NOT NULL,
	`phone` text NOT NULL,
	`whatsapp` text NOT NULL,
	`rating` real NOT NULL,
	`reviews` integer NOT NULL,
	`website` text,
	`email` text,
	`score` integer,
	`top_reason` text NOT NULL,
	`evidence` text NOT NULL,
	`status` text DEFAULT 'saved' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`pitch` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`reminder_at` integer,
	`reminder_note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_lead`("user_id", "id", "name", "category", "area", "phone", "whatsapp", "rating", "reviews", "website", "email", "score", "top_reason", "evidence", "status", "position", "pitch", "notes", "reminder_at", "reminder_note", "created_at") SELECT "user_id", "id", "name", "category", "area", "phone", "whatsapp", "rating", "reviews", "website", "email", "score", "top_reason", "evidence", "status", "position", "pitch", "notes", "reminder_at", "reminder_note", "created_at" FROM `lead`;--> statement-breakpoint
DROP TABLE `lead`;--> statement-breakpoint
ALTER TABLE `__new_lead` RENAME TO `lead`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `lead_user_reminder` ON `lead` (`user_id`,`reminder_at`);