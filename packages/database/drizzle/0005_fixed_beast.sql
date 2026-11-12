CREATE TABLE "link_click_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"visitor_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_view_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"visitor_id" varchar(64) NOT NULL,
	"path" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_view_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"visitor_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "link_click_events" ADD CONSTRAINT "link_click_events_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_click_events" ADD CONSTRAINT "link_click_events_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_view_events" ADD CONSTRAINT "page_view_events_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_view_events" ADD CONSTRAINT "product_view_events_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_view_events" ADD CONSTRAINT "product_view_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_click_events_creator_created_idx" ON "link_click_events" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "link_click_events_link_idx" ON "link_click_events" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "page_view_events_creator_created_idx" ON "page_view_events" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "page_view_events_creator_visitor_idx" ON "page_view_events" USING btree ("creator_id","visitor_id");--> statement-breakpoint
CREATE INDEX "product_view_events_creator_created_idx" ON "product_view_events" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "product_view_events_product_idx" ON "product_view_events" USING btree ("product_id");