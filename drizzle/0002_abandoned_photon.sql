CREATE TABLE `crawl_cache` (
	`site_key` text PRIMARY KEY NOT NULL,
	`facts` text NOT NULL,
	`crawled_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `lead` ADD `whatsapp_phone` text;--> statement-breakpoint
ALTER TABLE `lead` ADD `audited_at` integer;