import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
let checks = 0;
function check(value, message) {
  assert.ok(value, message);
  checks++;
  console.log(`PASS ${message}`);
}
async function api(path, body, token, expected = 200) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  assert.equal(response.status, expected, data.error || path);
  return data;
}
const created = await api("/api/rooms", { name: "弃票房主", roomName: "弃票功能验收" }, undefined, 201);
const path = `/api/rooms/${created.room.code}`;
const joined = await Promise.all(["弃票甲", "弃票乙", "弃票丙"].map((name) => api(path, { action: "join", name })));
const seats = [created, ...joined].map((x) => ({ id: x.room.me.id, token: x.token }));
const settings = { mode: "anonymous", allowSelf: false, tieRule: "shared", penalties: ["下一局负责报点"] };
let round;
async function start(overrides = {}) {
  const result = await api(path, { action: "start", settings: { ...settings, ...overrides } }, seats[0].token);
  round = result.room.rounds.at(-1);
  return result.room;
}
const read = (i = 0) => api(path, undefined, seats[i].token);
const vote = (i, targetId, extra = {}, expected = 200) => api(path, {
  action: "vote", roundId: round.id, phase: round.phase, targetId, ...extra,
}, seats[i].token, expected);

await start();
for (const invalid of [undefined, "", "missing", false]) await vote(0, invalid, {}, 400);
check(true, "只有显式 null 才是弃票，缺失或非法目标仍被拒绝");
await vote(0, null, { reason: "PRIVATE_ABSTAIN_REASON" });
let room = await read();
check(room.rounds.at(-1).submitted && room.rounds.at(-1).myAbstained && room.rounds.at(-1).myTargetId === null, "禁止自投时仍可弃票，重新读取保留自己的弃票状态");
const unseen = (await read(1)).rounds.at(-1);
check(unseen.phase === "voting" && unseen.ballotCount === 1 && unseen.abstentionCount === 0 && !unseen.myAbstained && !unseen.tally.length && !unseen.ballots.length && !JSON.stringify(unseen).includes("PRIVATE_ABSTAIN_REASON"), "揭晓前不向别人泄露弃票人数、身份或理由");
await vote(0, seats[1].id, {}, 409);
await vote(0, null, {}, 409);
check(true, "弃票后既不能改为投人，也不能重复弃票");
await Promise.all([1, 2, 3].map((i) => vote(i, null)));
room = await read();
const noVerdict = room.rounds.at(-1);
check(noVerdict.phase === "result" && !noVerdict.winners.length && noVerdict.abstentionCount === 4 && !noVerdict.hadRunoff && noVerdict.tally.every((t) => t.count === 0), "并发全员弃票直接结算无人背锅，不进入四人零票加投");
check(noVerdict.penalty === "" && !noVerdict.randomDecided && !noVerdict.completedBy.length, "无人背锅不安排惩罚，也不随机抽人");
const snapshots = await Promise.all(seats.map((_, i) => read(i)));
check(snapshots.every((r) => !r.rounds.at(-1).winners.length && r.rounds.at(-1).abstentionCount === 4 && !r.rounds.at(-1).ballots.length && !JSON.stringify(r).includes("PRIVATE_ABSTAIN_REASON")), "四个身份看到一致无人背锅结果，弃票不公开投票理由");
await api(path, { action: "complete", roundId: round.id }, seats[0].token, 403);
check(true, "无惩罚局拒绝伪造完成惩罚请求");

await start({ mode: "named" });
check(round.phase === "voting" && round.number === 2, "无人背锅后房主可正常开启下一局");
await Promise.all(seats.map((_, i) => vote(i, i === 0 || i === 2 ? seats[1].id : null)));
room = await read();
const mixed = room.rounds.at(-1);
check(mixed.winners.length === 1 && mixed.winners[0] === seats[1].id && mixed.abstentionCount === 2 && mixed.tally.reduce((sum, t) => sum + t.count, 0) === 2, "两票加两张弃票时达到门槛，弃票不参与排名");
check(mixed.ballots.filter((b) => b.targetId === null).length === 2 && mixed.penalty === settings.penalties[0], "实名结果公开弃票明细，有当选者时正常保留惩罚");

await start({ mode: "named" });
await Promise.all([vote(0, seats[1].id), vote(1, seats[0].id), vote(2, seats[1].id), vote(3, seats[0].id)]);
round = (await read()).rounds.at(-1);
check(round.phase === "runoff" && round.candidates.length === 2 && round.initialAbstentionCount === 0 && round.ballotCount === 0 && !round.submitted, "两人各两票时加投，四人需重新提交");
await vote(0, null, { phase: "voting" }, 409);
check(true, "首轮延迟的弃票请求不能进入加投");
await Promise.all(seats.map((_, i) => vote(i, null)));
room = await read();
const runoffNone = room.rounds.at(-1);
check(runoffNone.phase === "result" && !runoffNone.winners.length && runoffNone.abstentionCount === 4 && runoffNone.penalty === "" && runoffNone.initialTally.reduce((sum, t) => sum + t.count, 0) === 4, "加投全员弃票可结束为无人背锅，首轮票数保留");
check(runoffNone.ballots.every((b) => b.targetId === null) && runoffNone.initialBallots.length === 4, "实名首轮四票与加投弃票分别记录");

await start({ tieRule: "random" });
await Promise.all(seats.map((_, i) => vote(i, null)));
room = await read();
check(!room.rounds.at(-1).winners.length && !room.rounds.at(-1).randomDecided, "随机平票规则也不会从零票队员中选战犯");
check(room.rounds.filter((r) => r.phase === "result").length === 4 && room.rounds.filter((r) => r.winners.length).length === 1 && room.rounds.reduce((sum, r) => sum + r.winners.length, 0) === 1, "历史保留全部结算局，无人背锅局不增加任何人的当选次数");
assert.deepEqual((await read(3)).rounds.map((r) => [r.winners, r.abstentionCount, r.penalty]), room.rounds.map((r) => [r.winners, r.abstentionCount, r.penalty]));
check(true, "重新读取数据库保留弃票人数、无战犯结果与惩罚状态");
console.log(`RESULT: ${checks} abstention checks passed, 0 failed`);
