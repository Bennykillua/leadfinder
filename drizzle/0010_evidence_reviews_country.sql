CREATE TABLE `review_cache` (
	`place_id` text PRIMARY KEY NOT NULL,
	`response` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `lead` ADD `country` text;--> statement-breakpoint
ALTER TABLE `lead` ADD `phone_intl` text;--> statement-breakpoint
ALTER TABLE `lead` ADD `ai_timing` text;--> statement-breakpoint
ALTER TABLE `lead` ADD `review_samples` text;--> statement-breakpoint
ALTER TABLE `lead` ADD `pitch_evidence` text;