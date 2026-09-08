import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { deliveriesTable } from "./deliveries";

export const deliveryPhotosTable = pgTable(
  "delivery_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveriesTable.id, { onDelete: "cascade" }),
    objectPath: text("object_path").notNull(),
    fileName: text("file_name").notNull().default("Акт доставки"),
    mimeType: text("mime_type").notNull().default("image/jpeg"),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletionPendingAt: timestamp("deletion_pending_at", { withTimezone: true }),
  },
  (table) => [
    index("delivery_photos_delivery_idx").on(table.deliveryId),
    uniqueIndex("delivery_photos_object_path_uq").on(table.objectPath),
  ],
);

export type DeliveryPhoto = typeof deliveryPhotosTable.$inferSelect;
