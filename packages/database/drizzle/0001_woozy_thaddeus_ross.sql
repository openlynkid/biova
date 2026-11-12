CREATE TYPE "public"."page_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"url" text NOT NULL,
	"description" varchar(240),
	"icon" varchar(32),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "creators_user_id_idx";--> statement-breakpoint
DROP INDEX "pages_creator_id_idx";--> statement-breakpoint
ALTER TABLE "pages" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."page_status";--> statement-breakpoint
ALTER TABLE "pages" ALTER COLUMN "status" SET DATA TYPE "public"."page_status" USING "status"::"public"."page_status";--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "links_creator_sort_idx" ON "links" USING btree ("creator_id","sort_order");--> statement-breakpoint
ALTER TABLE "page_blocks" ADD CONSTRAINT "page_blocks_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pages_status_idx" ON "pages" USING btree ("status");--> statement-breakpoint
ALTER TABLE "creators" ADD CONSTRAINT "creators_user_id_unique" UNIQUE("user_id");--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_creator_id_unique" UNIQUE("creator_id");