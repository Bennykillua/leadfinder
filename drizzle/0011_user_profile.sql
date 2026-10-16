ALTER TABLE `user` ADD `niche` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `portfolio_links` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `rate` text DEFAULT '' NOT NULL;