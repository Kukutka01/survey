CREATE TABLE `private_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`encrypted_profile` text NOT NULL,
	`consent_version` integer NOT NULL,
	`consent_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limits_expiry_idx` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `survey_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`answers` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`version` integer NOT NULL
);
