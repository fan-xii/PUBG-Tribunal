import {
  applyAction,
  GameError,
  publicRoom,
  textValue,
  type Room,
} from "@/lib/game";
import {
  errorResponse,
  hashToken,
  newToken,
  readRoom,
  requestBody,
  updateRoom,
} from "@/lib/room-store";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ code: string }> };
async function codeOf(context: Context) {
  const code = (await context.params).code.toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code))
    throw new GameError("请输入正确的六位房间码");
  return code;
}
async function credential(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || token.length > 150) throw new GameError("请先加入房间", 401);
  return hashToken(token);
}
function memberOf(room: Room, hash: string) {
  const member = room.members.find((m) => m.tokenHash === hash);
  if (!member) throw new GameError("房间身份已失效或已被移出，请重新加入或联系房主", 401);
  return member;
}
export async function GET(request: Request, context: Context) {
  try {
    const code = await codeOf(context);
    const hash = await credential(request);
    const { room } = await readRoom(code);
    return Response.json(publicRoom(room, memberOf(room, hash)), {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const code = await codeOf(context);
    const body = await requestBody(request);
    if (body.action === "join") {
      const name = textValue(body.name, "昵称", 12);
      const token = newToken();
      const member = {
        id: crypto.randomUUID(),
        name,
        tokenHash: await hashToken(token),
        joinedAt: new Date().toISOString(),
      };
      const room = await updateRoom(code, (room) => {
        if (room.members.length >= 4 || ["voting", "runoff"].includes(room.rounds.at(-1)?.phase || ""))
          throw new GameError(
            "房间已满或正在投票，请使用原席位或等待空位",
            409,
          );
        if (
          room.members.some(
            (m) => m.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          )
        )
          throw new GameError("昵称已被队友使用，请换一个", 409);
        room.members.push(member);
      });
      return Response.json(
        { token, room: publicRoom(room, member) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const hash = await credential(request);
    const room = await updateRoom(code, (room) =>
      applyAction(room, memberOf(room, hash), body),
    );
    return Response.json(
      { room: publicRoom(room, memberOf(room, hash)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
