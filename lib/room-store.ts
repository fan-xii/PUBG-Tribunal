import { env } from "cloudflare:workers";
import { GameError, type Room } from "./game";

export function database() {
  if (!env.DB) throw new GameError("数据库尚未配置，请联系房主", 503);
  return env.DB;
}
export async function insertRoom(room: Room) {
  const result = await database()
    .prepare("INSERT OR IGNORE INTO rooms (code, document, revision, updated_at) VALUES (?, ?, 0, ?)")
    .bind(room.code, JSON.stringify(room), room.createdAt)
    .run();
  return result.meta.changes === 1;
}
export async function readRoom(code: string) {
  const row = await database()
    .prepare("SELECT document, revision FROM rooms WHERE code = ?")
    .bind(code)
    .first<{ document: string; revision: number }>();
  if (!row) throw new GameError("没有找到这个房间，请检查房间码", 404);
  return { room: JSON.parse(row.document) as Room, revision: row.revision };
}
export async function updateRoom(code: string, mutate: (room: Room) => void) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const { room, revision } = await readRoom(code);
    mutate(room);
    const result = await database()
      .prepare(
        "UPDATE rooms SET document = ?, revision = revision + 1, updated_at = ? WHERE code = ? AND revision = ?",
      )
      .bind(JSON.stringify(room), new Date().toISOString(), code, revision)
      .run();
    if (result.meta.changes === 1) return room;
  }
  throw new GameError("提交人数较多，请稍后重试", 409);
}
export { hashToken, newToken, errorResponse, requestBody } from "./room-http";
