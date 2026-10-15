import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
// 同一房间的状态和计票通过 revision 乐观锁原子更新。
export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  document: text("document").notNull(),
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});
