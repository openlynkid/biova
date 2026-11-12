CREATE TABLE "product_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_assets" ADD CONSTRAINT "product_assets_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_assets" ADD CONSTRAINT "product_assets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_assets_storage_key_uq" ON "product_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "product_assets_product_sort_idx" ON "product_assets" USING btree ("product_id","sort_order");