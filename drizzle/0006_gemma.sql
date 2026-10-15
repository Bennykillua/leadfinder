CREATE TABLE `llm_call` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`lead_id` text,
	`prompt_type` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer NOT NULL,
	`valid_first_try` integer NOT NULL,
	`attempts` integer NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `llm_call_at` ON `llm_call` (`at`);--> statement-breakpoint
ALTER TABLE `lead` ADD `ai_score` integer;--> statement-breakpoint
ALTER TABLE `lead` ADD `ai_top_reason` text;--> statement-breakpoint
ALTER TABLE `lead` ADD `ai_findings` text;--> statement-breakpoint
ALTER TABLE `lead` ADD `ai_model` text;--> statement-breakpoint
ALTER TABLE `lead` ADD `ai_at` integer;