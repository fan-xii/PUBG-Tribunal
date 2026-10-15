import {
  defaultSettings,
  GameError,
  publicRoom,
  textValue,
  randomItem,
  type Room,
} from "@/lib/game";
import {
  database,
  errorResponse,
  hashToken,
  newToken,
  requestBody,
} from "@/lib/room-store";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const body = await requestBody(request);
    const name = textValue(body.name, "昵称", 12);
    const roomName = textValue(
      body.roomName || "今晚吃鸡小分队",
      "房间名称",
      24,
    );
    const token = newToken();
    const member = {
      id: crypto.randomUUID(),
      name,
      tokenHash: await hashToken(token),
      joinedAt: new Date().toISOString(),
    };
    for (let i = 0; i < 8; i++) {
      const code = Array.from({ length: 6 }, () =>
        randomItem("ABCDEFGHJKLMNPQRSTUVWXYZ23456789".split("")),
      ).join("");
      const room: Room = {
        code,
        name: roomName,
        hostId: member.id,
        createdAt: new Date().toISOString(),
        members: [member],
        settings: structuredClone(defaultSettings),
        rounds: [],
      };
      const result = await database()
        .prepare(
          "INSERT OR IGNORE INTO rooms (code, document, revision, updated_at) VALUES (?, ?, 0, ?)",
        )
        .bind(code, JSON.stringify(room), room.createdAt)
        .run();
      if (result.meta.changes === 1)
        return Response.json(
          { token, room: publicRoom(room, member) },
          { status: 201, headers: { "Cache-Control": "no-store" } },
        );
    }
    throw new GameError("创建房间失败，请重试", 503);
  } catch (error) {
    return errorResponse(error);
  }
}
