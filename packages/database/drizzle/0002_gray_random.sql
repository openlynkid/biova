CREATE TYPE "public"."product_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"slug" varchar(48) NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" text,
	"price_idr" integer NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_creator_slug_uq" ON "products" USING btree ("creator_id","slug");--> statement-breakpoint
CREATE INDEX "products_creator_sort_idx" ON "products" USING btree ("creator_id","sort_order");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");