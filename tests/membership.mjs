import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
let checks = 0;
function check(value, message) {
  assert.ok(value, message);
  console.log(`PASS ${message}`);
  checks++;
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
const created = await api("/api/rooms", { name: "原房主", roomName: "成员管理验收" }, undefined, 201);
const path = `/api/rooms/${created.room.code}`;
const joined = await Promise.all(["接任队员", "离队队员", "第三队员"].map((name) => api(path, { action: "join", name })));
const seats = [created, ...joined].map((x) => ({ id: x.room.me.id, token: x.token }));
const settings = { mode: "anonymous", allowSelf: true, tieRule: "shared", penalties: ["报点一局"] };
for (const action of ["kick", "transferHost"]) {
  await api(path, { action, targetId: seats[2].id }, seats[1].token, 403);
  await api(path, { action, targetId: seats[0].id }, seats[0].token, 400);
  await api(path, { action, targetId: "missing" }, seats[0].token, 409);
}
check(true, "管理操作拒绝非房主、自操作及已离队目标");
let room = (await api(path, { action: "start", settings }, seats[0].token)).room;
await api(path, { action: "kick", targetId: seats[2].id }, seats[0].token, 409);
check((await api(path, undefined, seats[2].token)).members.length === 4, "投票中禁止踢人且成员状态不变");
room = (await api(path, { action: "transferHost", targetId: seats[1].id }, seats[0].token)).room;
check(room.hostId === seats[1].id && !room.me.isHost, "投票中可转移房主，原房主立即降为普通成员");
await api(path, { action: "cancel", roundId: room.rounds.at(-1).id }, seats[0].token, 403);
await api(path, { action: "kick", targetId: seats[3].id }, seats[0].token, 403);
check(true, "原房主立即失去作废与踢人权限");
async function finish(targetIndex, voters = seats) {
  const current = (await api(path, undefined, voters[0].token)).rounds.at(-1);
  await Promise.all(voters.map((s) => api(path, {
    action: "vote", roundId: current.id, phase: current.phase, targetId: voters[targetIndex].id, reason: "验收理由",
  }, s.token)));
  return api(path, undefined, voters[0].token);
}
room = await finish(2);
check(room.rounds.at(-1).phase === "result" && room.rounds.at(-1).winners[0] === seats[2].id, "转移房主不影响当前选票和结算");
await api(path, { action: "start", settings: { ...settings, mode: "named" } }, seats[1].token);
room = await finish(2);
const history = structuredClone(room.rounds);
room = (await api(path, { action: "kick", targetId: seats[2].id }, seats[1].token)).room;
check(room.members.length === 3 && room.formerMembers[0].id === seats[2].id && room.formerMembers[0].name === "离队队员", "踢人释放席位并保留离队成员姓名");
await api(path, undefined, seats[2].token, 401);
await api(path, { action: "start", settings }, seats[2].token, 401);
check(true, "被踢成员旧凭证无法读取、写入或恢复原席位");
assert.deepEqual(room.rounds.map((r) => [r.tally, r.initialTally, r.ballots, r.initialBallots]), history.map((r) => [r.tally, r.initialTally, r.ballots, r.initialBallots]));
check(!JSON.stringify(room).includes("tokenHash"), "踢人后匿名隐私、实名明细与历史票数保持不变");
const replacement = await api(path, { action: "join", name: "补位队员" });
room = replacement.room;
check(room.members.length === 4 && room.me.id !== seats[2].id, "已有对局的房间可由新队员补位");
assert.deepEqual(room.rounds.map((r) => r.tally), history.map((r) => r.tally));
check(room.rounds[0].tally.some((t) => t.memberId === seats[2].id) && !room.rounds[0].tally.some((t) => t.memberId === room.me.id), "新队员不替换历史候选人与票数");
const currentSeats = [seats[0], seats[1], seats[3], { id: room.me.id, token: replacement.token }];
await api(path, { action: "start", settings }, seats[1].token);
room = await finish(3, currentSeats);
check(room.rounds.at(-1).winners[0] === room.members.find((m) => m.name === "补位队员").id && !room.rounds.at(-1).tally.some((t) => t.memberId === seats[2].id), "补位后按新的四人阵容开局与计票");
const transfers = await Promise.all([seats[0], seats[3]].map((target) => raw(path, { action: "transferHost", targetId: target.id }, seats[1].token)));
check(transfers.filter((x) => x.status === 200).length === 1 && transfers.filter((x) => x.status === 403).length === 1, "并发转移只有一人成功，旧房主不能覆盖新房主决定");
room = await api(path, undefined, seats[0].token);
check([seats[0].id, seats[3].id].includes(room.hostId) && !(await api(path, undefined, seats[1].token)).me.isHost, "四人读取一致的新房主状态");

// 兼容升级前没有 participantIds 的持久化房间。
const { code } = await transform(await readFile(new URL("../lib/game.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm", target: "node22" });
const game = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const legacy = { code: "LEG234", name: "旧房间", createdAt: new Date().toISOString(), hostId: "0", settings, rounds: [], members: ["0", "1", "2", "3"].map((id) => ({ id, name: `旧成员${id}`, tokenHash: "test-hash", joinedAt: new Date().toISOString() })) };
for (const mode of ["anonymous", "named"]) {
  game.applyAction(legacy, legacy.members[0], { action: "start", settings: { ...settings, mode } });
  const round = legacy.rounds.at(-1);
  for (const member of legacy.members) game.applyAction(legacy, member, { action: "vote", roundId: round.id, phase: "voting", targetId: "2" });
  delete round.participantIds;
}
const before = game.publicRoom(legacy, legacy.members[0]);
game.applyAction(legacy, legacy.members[0], { action: "kick", targetId: "2" });
const after = game.publicRoom(legacy, legacy.members[0]);
assert.deepEqual(after.rounds, before.rounds);
check(after.formerMembers[0].name === "旧成员2", "旧数据在首次踢人前补齐阵容，匿名与实名历史完全兼容");
console.log(`RESULT: ${checks} membership checks passed, 0 failed`);
