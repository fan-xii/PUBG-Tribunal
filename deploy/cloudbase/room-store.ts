import cloudbase from "@cloudbase/node-sdk";
import { GameError, type Room } from "../../lib/game";
export { hashToken, newToken, errorResponse, requestBody } from "../../lib/room-http";

// 普通事件云函数使用运行时临时凭证；浏览器不直接访问数据库。
let db: ReturnType<ReturnType<typeof cloudbase.init>["database"]>;
function rooms() {
  db ??= cloudbase.init({ env: process.env.TCB_ENV || cloudbase.SYMBOL_DEFAULT_ENV }).database();
  return db.collection("squad_rooms");
}
export async function insertRoom(room: Room) {
  try {
    await rooms().add({ _id: room.code, document: JSON.stringify(room), revision: 0 });
    return true;
  } catch (error) {
    // 只把主键冲突当作房间码碰撞；权限、网络错误必须向上传递。
    if (/duplicate key|E11000|DOCUMENT_ALREADY_EXISTS/i.test(String(error))) return false;
    throw error;
  }
}
export async function readRoom(code: string) {
  const result = await rooms().doc(code).get();
  const row = result.data[0];
  if (!row) throw new GameError("没有找到这个房间，请检查房间码", 404);
  return { room: JSON.parse(row.document) as Room, revision: row.revision as number };
}
export async function updateRoom(code: string, mutate: (room: Room) => void) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { room, revision } = await readRoom(code);
    mutate(room);
    const result = await rooms().where({ _id: code, revision }).update({
      document: JSON.stringify(room), revision: revision + 1,
    });
    if (result.updated === 1) return room;
  }
  throw new GameError("提交人数较多，请稍后重试", 409);
}
