import { env } from "cloudflare:workers";
import { GameError, type Room } from "./game";

export function database() {
  if (!env.DB) throw new GameError("数据库尚未配置，请联系房主", 503);
  return env.DB;
}
export async function hashToken(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export function newToken() {
  return crypto.randomUUID() + crypto.randomUUID();
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
export function errorResponse(error: unknown) {
  if (error instanceof GameError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  console.error(
    "Room API error",
    error instanceof Error ? error.message : "unknown",
  );
  return Response.json(
    { error: "服务暂时不可用，请稍后重试" },
    { status: 500 },
  );
}
export async function requestBody(request: Request) {
  const raw = await request.text();
  if (raw.length > 8192) throw new GameError("提交内容过长", 413);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new GameError("提交格式不正确");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new GameError("提交格式不正确");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new GameError("不允许跨站提交", 403);
  return data as Record<string, unknown>;
}
