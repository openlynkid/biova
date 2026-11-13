CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"dedupe_key" varchar(160) NOT NULL,
	"recipient_email" varchar(254) NOT NULL,
	"recipient_name" varchar(120),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(300),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_dedupe_uq" ON "notification_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_outbox_creator_created_idx" ON "notification_outbox" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_outbox_status_idx" ON "notification_outbox" USING btree ("status");