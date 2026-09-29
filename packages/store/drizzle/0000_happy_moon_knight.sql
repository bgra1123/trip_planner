CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`segment_id` text,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`place_ref` text,
	`starts_at` text,
	`ends_at` text,
	`cost` text,
	`source` text NOT NULL,
	`captured_at` text NOT NULL,
	`expires_at` text,
	`cancellable_until` text,
	`raw` text,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`text` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`kind` text NOT NULL,
	`city` text,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`ordering` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trip_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`label` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`travelers` text NOT NULL,
	`home_base` text NOT NULL,
	`currency` text NOT NULL,
	`budget_total` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
