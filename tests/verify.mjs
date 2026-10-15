import assert from "node:assert/strict";
import { createInterface } from "node:readline/promises";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
  console.log(`PASS ${message}`);
}
async function api(path, body, token, expected = 200) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    expected,
    `${path}: ${data.error || response.status}`,
  );
  return data;
}
const settings = {
  mode: "anonymous",
  allowSelf: true,
  tieRule: "shared",
  penalties: ["下一局担任专职司机"],
};
const created = await api(
  "/api/rooms",
  { name: "小王", roomName: "四人流程验证" },
  undefined,
  201,
);
const code = created.room.code,
  path = `/api/rooms/${code}`;
const seats = [{ token: created.token, id: created.room.me.id }];
check(/^[A-Z2-9]{6}$/.test(code), "创建六位房间码");
await api(path, undefined, undefined, 401);
await api(path, undefined, "invalid", 401);
check(true, "未加入者与伪造身份无法读取房间");
await api(path, { action: "start", settings }, seats[0].token, 409);
check(true, "未满四人不能开局");
await api(path, { action: "join", name: "小王" }, undefined, 409);
check(true, "禁止重复昵称");
const joined = await Promise.all(
  ["老李", "阿杰", "阿明"].map((name) => api(path, { action: "join", name })),
);
seats.push(...joined.map((x) => ({ token: x.token, id: x.room.me.id })));
const lobby = await api(path, undefined, seats[0].token);
check(lobby.members.length === 4, "三人同时加入不丢席位");
check(
  !JSON.stringify(lobby).includes("tokenHash") &&
    !JSON.stringify(lobby).includes(seats[1].token),
  "身份凭证不出现在公共响应中",
);
await api(path, { action: "join", name: "第五人" }, undefined, 409);
check(true, "第五人无法加入");
await api(path, { action: "start", settings }, seats[1].token, 403);
check(true, "只有房主可以开局");
await api(
  path,
  { action: "start", settings: { ...settings, penalties: [] } },
  seats[0].token,
  400,
);
check(true, "拒绝空惩罚清单");
let room = (await api(path, { action: "start", settings }, seats[0].token))
  .room;
let round = room.rounds.at(-1);
check(
  round.phase === "voting" &&
    round.mode === "anonymous" &&
    round.penalty === settings.penalties[0],
  "匿名局锁定规则并展示惩罚",
);
await api(
  path,
  { action: "start", settings: { ...settings, mode: "named" } },
  seats[0].token,
  409,
);
check(true, "进行中不可切换模式或重复开局");
const vote = (i, target, phase = "voting", roundId = round.id) =>
  api(
    path,
    {
      action: "vote",
      roundId,
      phase,
      targetId: seats[target].id,
      reason: "测试理由",
    },
    seats[i].token,
  );
await vote(0, 1);
await api(
  path,
  { action: "vote", roundId: round.id, phase: "voting", targetId: seats[2].id },
  seats[0].token,
  409,
);
check(true, "提交后不能重复投票或改票");
const waiting = await api(path, undefined, seats[2].token);
check(
  waiting.rounds.at(-1).ballotCount === 1 &&
    waiting.rounds.at(-1).tally.length === 0 &&
    waiting.rounds.at(-1).ballots.length === 0 &&
    !waiting.rounds.at(-1).myTargetId,
  "投票中只公开提交总数，不泄露选票",
);
await Promise.all([vote(1, 2), vote(2, 1), vote(3, 0)]);
const snapshots = await Promise.all(
  seats.map((s) => api(path, undefined, s.token)),
);
round = snapshots[0].rounds.at(-1);
check(
  round.phase === "result" && round.winners[0] === seats[1].id,
  "并发最后三票正确结算为 2:1:1",
);
check(
  snapshots.every(
    (s) =>
      JSON.stringify(s.rounds.at(-1).tally) === JSON.stringify(round.tally),
  ),
  "四个身份看到一致结果",
);
check(
  snapshots.every(
    (s) =>
      !s.rounds.at(-1).ballots.length && !s.rounds.at(-1).initialBallots.length,
  ),
  "匿名结果对房主和队员均隐藏投票关系",
);
check(
  snapshots.every((s) => s.rounds.at(-1).anonymousReasons.length === 4 && s.rounds.at(-1).anonymousReasons.every((b) => b.reason === "测试理由" && !Object.hasOwn(b, "voterId"))),
  "匿名局结算公开理由但不公开理由提交者",
);
await api(path, { action: "complete", roundId: round.id }, seats[0].token, 403);
check(true, "不能替别人确认惩罚");
room = (
  await api(path, { action: "complete", roundId: round.id }, seats[1].token)
).room;
check(room.rounds[0].completedBy.includes(seats[1].id), "战犯可以确认惩罚完成");
room = (
  await api(
    path,
    {
      action: "start",
      settings: { ...settings, mode: "named", allowSelf: false },
    },
    seats[0].token,
  )
).room;
round = room.rounds.at(-1);
await api(
  path,
  { action: "vote", roundId: round.id, phase: "voting", targetId: seats[0].id },
  seats[0].token,
  400,
);
check(true, "不允许自投时在服务端拦截");
await Promise.all([vote(0, 1), vote(1, 0), vote(2, 1), vote(3, 0)]);
room = await api(path, undefined, seats[0].token);
round = room.rounds.at(-1);
check(
  round.phase === "runoff" &&
    round.candidates.length === 2 &&
    round.ballotCount === 0 &&
    round.initialTally.length === 4,
  "2:2 平票自动进入一次加投",
);
await api(
  path,
  { action: "vote", roundId: round.id, phase: "voting", targetId: seats[1].id },
  seats[0].token,
  409,
);
check(true, "延迟首轮请求不能混入加投");
await api(
  path,
  { action: "vote", roundId: round.id, phase: "runoff", targetId: seats[2].id },
  seats[0].token,
  400,
);
check(true, "加投只能选择并列候选人");
await Promise.all([
  vote(0, 1, "runoff"),
  vote(1, 0, "runoff"),
  vote(2, 1, "runoff"),
  vote(3, 0, "runoff"),
]);
room = await api(path, undefined, seats[0].token);
round = room.rounds.at(-1);
check(
  round.phase === "result" && round.winners.length === 2,
  "加投仍平票按预设共同背锅",
);
check(
  round.ballots.length === 4 &&
    round.initialBallots.length === 4 &&
    round.ballots[0].reason === "测试理由",
  "实名结算展示首轮和加投明细及理由",
);
check(
  room.rounds[0].mode === "anonymous" && !room.rounds[0].ballots.length,
  "切换实名不会暴露历史匿名选票",
);
room = (
  await api(
    path,
    { action: "start", settings: { ...settings, tieRule: "random" } },
    seats[0].token,
  )
).room;
round = room.rounds.at(-1);
await Promise.all([vote(0, 1), vote(1, 0), vote(2, 1), vote(3, 0)]);
round = (await api(path, undefined, seats[0].token)).rounds.at(-1);
await Promise.all([
  vote(0, 1, "runoff"),
  vote(1, 0, "runoff"),
  vote(2, 1, "runoff"),
  vote(3, 0, "runoff"),
]);
room = await api(path, undefined, seats[0].token);
round = room.rounds.at(-1);
check(
  round.randomDecided &&
    round.winners.length === 1 &&
    [seats[0].id, seats[1].id].includes(round.winners[0]),
  "随机规则仅从加投并列者中抽一人",
);
room = (
  await api(
    path,
    { action: "start", settings: { ...settings, mode: "named" } },
    seats[0].token,
  )
).room;
round = room.rounds.at(-1);
await vote(0, 1);
await api(path, { action: "cancel", roundId: round.id }, seats[1].token, 403);
check(true, "普通队员不能作废投票");
room = (
  await api(path, { action: "cancel", roundId: round.id }, seats[0].token)
).room;
check(
  room.rounds.at(-1).phase === "cancelled" &&
    !room.rounds.at(-1).winners.length &&
    !room.rounds.at(-1).ballots.length,
  "作废局不产生战犯且保持选票隐藏",
);
await api(
  path,
  { action: "vote", roundId: round.id, phase: "voting", targetId: seats[0].id },
  seats[1].token,
  409,
);
check(true, "已结束的局次拒绝选票");
room = await api(path, undefined, seats[3].token);
check(
  room.rounds.length === 4 && room.members.length === 4,
  "重新读取保留全部历史和四个固定成员",
);
const cross = await fetch(base + path, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://untrusted.example",
    Authorization: `Bearer ${seats[0].token}`,
  },
  body: JSON.stringify({ action: "start", settings }),
});
check(cross.status === 403, "拒绝跨来源写入");
const bad = await fetch(base + path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{",
});
check(bad.status === 400, "非法 JSON 返回明确错误");
if (process.argv.includes("--restart")) {
  console.log(
    "READY_FOR_RESTART: restart the server, then press Enter. Tokens remain in process memory.",
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("");
  rl.close();
  const restored = await api(path, undefined, seats[0].token);
  check(
    restored.rounds.length === 4 && restored.members.length === 4,
    "服务器重启后历史、成员和身份仍可恢复",
  );
}
console.log(`RESULT: ${checks} passed, 0 failed`);
