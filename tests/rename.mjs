import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
let checks = 0;
function check(value, message) {
  assert.ok(value, message);
  checks++;
  console.log(`PASS ${message}`);
}
async function raw(path, body, token) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, data: await response.json() };
}
async function api(path, body, token, expected = 200) {
  const result = await raw(path, body, token);
  assert.equal(result.status, expected, result.data.error || path);
  return result.data;
}
const created = await api("/api/rooms", { name: "改名前房主", roomName: "昵称修改验收" }, undefined, 201);
const path = `/api/rooms/${created.room.code}`;
const joined = await Promise.all(["队员甲", "队员乙", "队员丙"].map((name) => api(path, { action: "join", name })));
const seats = [created, ...joined].map((x) => ({ id: x.room.me.id, token: x.token }));
const read = (i = 0) => api(path, undefined, seats[i].token);
const memberAt = (room, i) => room.members.find((m) => m.id === seats[i].id);
const rename = (i, name, expected = 200, extra = {}) => api(path, { action: "rename", name, ...extra }, seats[i].token, expected);
const settings = { mode: "named", allowSelf: true, tieRule: "shared", penalties: ["负责报点"] };

await api(path, { action: "rename", name: "伪造" }, undefined, 401);
await api(path, { action: "rename", name: "伪造" }, "invalid", 401);
await rename(0, "伪造", 403, { targetId: seats[1].id });
check(memberAt(await read(), 1).name === "队员甲", "缺失或伪造凭证不能改名，房主也不能替别人改名");
for (const value of [undefined, null, 3, "", "   ", "a\nb", "a".repeat(13)]) await rename(0, value, 400);
check((await read()).members[0].name === "改名前房主", "空白、超长、控制字符及非法昵称均被拒绝且原名不变");
let room = (await rename(0, "  NewHost  ")).room;
check(room.members[0].name === "NewHost" && room.me.id === seats[0].id && room.me.isHost && room.members[0].joinedAt === created.room.members[0].joinedAt && !room.formerMembers.length, "改名去除首尾空格且保留原席位、加入时间和房主权限");
await rename(0, "newhost");
await rename(1, "NEWHOST", 409);
check((await read(0)).members[0].name === "newhost", "可修改自己昵称的大小写，不能与队友大小写变体重名");
room = (await rename(1, "普通队员新名")).room;
check(!room.me.isHost && room.me.id === seats[1].id && memberAt(room, 1).name === "普通队员新名", "普通成员可自行改名，无需房主踢人或转移权限");
await api(path, { action: "start", settings }, seats[0].token);
let round = (await read()).rounds.at(-1);
const vote = (i, targetId) => api(path, { action: "vote", roundId: round.id, phase: round.phase, targetId }, seats[i].token);
await rename(1, "投票中改名", 409);
check(memberAt(await read(1), 1).name === "普通队员新名", "首轮投票中禁止改名，保持候选人名称稳定");
await Promise.all([vote(0, seats[0].id), vote(1, seats[0].id), vote(2, seats[1].id), vote(3, seats[1].id)]);
round = (await read()).rounds.at(-1);
await rename(0, "加投中改名", 409);
check(round.phase === "runoff" && (await read()).members[0].name === "newhost", "加投中同样禁止改名");
await Promise.all(seats.map((_, i) => vote(i, seats[1].id)));
const before = await read(1);
room = (await rename(1, "背锅也不换席位")).room;
assert.deepEqual(room.rounds, before.rounds);
check(memberAt(room, 1).name === "背锅也不换席位" && room.rounds[0].winners[0] === seats[1].id && room.rounds[0].ballots.length === 4 && room.rounds[0].initialBallots.length === 4, "结算后改名保留首轮、加投、当选记录及实名投票关系");
await api(path, { action: "complete", roundId: round.id }, seats[1].token);
const views = await Promise.all(seats.map((_, i) => read(i)));
check(views.every((r) => memberAt(r, 1).name === "背锅也不换席位" && r.rounds[0].completedBy.includes(seats[1].id)), "四人读取一致新昵称，原凭证仍可恢复席位和确认惩罚");
const collisions = await Promise.all([1, 2].map((i) => raw(path, { action: "rename", name: "并发昵称" }, seats[i].token)));
check(collisions.filter((r) => r.status === 200).length === 1 && collisions.filter((r) => r.status === 409).length === 1 && (await read()).members.filter((m) => m.name === "并发昵称").length === 1, "同时改成同一昵称只有一人成功，数据库重试不产生重名");
await api(path, { action: "start", settings: { ...settings, mode: "anonymous" } }, seats[0].token);
round = (await read()).rounds.at(-1);
await api(path, { action: "cancel", roundId: round.id }, seats[0].token);
room = (await rename(2, "作废后可改名")).room;
check(memberAt(room, 2).name === "作废后可改名" && room.rounds.at(-1).phase === "cancelled", "作废后可改名且不改变已作废对局");
await api(path, { action: "kick", targetId: seats[3].id }, seats[0].token);
await rename(3, "被踢后改名", 401);
check((await read()).formerMembers[0].name === "队员丙", "被踢成员的旧凭证不能通过改名恢复席位或篡改离队记录");
console.log(`RESULT: ${checks} rename checks passed, 0 failed`);
