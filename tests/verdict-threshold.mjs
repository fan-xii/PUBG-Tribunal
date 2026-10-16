import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; console.log(`PASS ${message}`); }
async function api(path, body, token, expected = 200) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  assert.equal(response.status, expected, data.error || path);
  return data;
}
const created = await api("/api/rooms", { name: "门槛房主", roomName: "两票门槛验收" }, undefined, 201);
const path = `/api/rooms/${created.room.code}`;
const joined = await Promise.all(["队员甲", "队员乙", "队员丙"].map((name) => api(path, { action: "join", name })));
const seats = [created, ...joined].map((x) => ({ id: x.room.me.id, token: x.token }));
const settings = { mode: "named", allowSelf: true, tieRule: "random", penalties: ["负责报点"] };
const read = (i = 0) => api(path, undefined, seats[i].token);
let round;
async function votes(targets) {
  await Promise.all(targets.map((target, i) => api(path, {
    action: "vote", roundId: round.id, phase: round.phase,
    targetId: target === null ? null : seats[target].id, reason: target === null ? "" : `理由${i}`,
  }, seats[i].token)));
  round = (await read()).rounds.at(-1);
}
const tie = [0, 0, 1, 1];
const cases = [
  { label: "首轮 1:1:1:1 直接无战犯，不进入加投", initial: [0, 1, 2, 3], reason: "insufficient-votes" },
  { label: "首轮一票三弃不能判战犯", initial: [0, null, null, null], reason: "insufficient-votes" },
  { label: "首轮 1:1 加两弃不进入加投", initial: [0, 1, null, null], reason: "insufficient-votes" },
  { label: "首轮 2:1:1 的两票者当选", initial: [0, 0, 1, 2], winner: 0 },
  { label: "首轮两票两弃的两票者当选", initial: [0, 0, null, null], winner: 0 },
  { label: "首轮 3:1 的三票者当选", initial: [0, 0, 0, 1], winner: 0 },
  { label: "首轮四票者当选", initial: [0, 0, 0, 0], winner: 0 },
  { label: "首轮全弃继续无战犯", initial: [null, null, null, null], reason: "all-abstained" },
  { label: "首轮 2:2 加投仍 2:2 无战犯，不随机或共同背锅", initial: tie, runoff: [0, 1, 0, 1], reason: "runoff-tied" },
  { label: "加投 1:1 加两弃无战犯", initial: tie, runoff: [0, 1, null, null], reason: "insufficient-votes" },
  { label: "加投一票三弃无战犯", initial: tie, runoff: [0, null, null, null], reason: "insufficient-votes" },
  { label: "加投 2:1 加一弃的两票者当选", initial: tie, runoff: [0, 0, 1, null], winner: 0 },
  { label: "加投两票两弃的两票者当选", initial: tie, runoff: [0, 0, null, null], winner: 0 },
  { label: "加投 3:1 的三票者当选", initial: tie, runoff: [0, 0, 0, 1], winner: 0 },
  { label: "加投全弃无战犯，保留首轮票数", initial: tie, runoff: [null, null, null, null], reason: "all-abstained" },
];
for (const scenario of cases) {
  round = (await api(path, { action: "start", settings }, seats[0].token)).room.rounds.at(-1);
  assert.equal(round.verdictRule, "minimum-two");
  await votes(scenario.initial);
  if (scenario.runoff) {
    assert.equal(round.phase, "runoff");
    assert.deepEqual([...round.candidates].sort(), [seats[0].id, seats[1].id].sort());
    await votes(scenario.runoff);
    assert.equal(round.initialTally.reduce((sum, entry) => sum + entry.count, 0), 4);
    assert.equal(round.initialBallots.length, 4);
  }
  assert.equal(round.phase, "result");
  assert.equal(round.randomDecided, false);
  assert.equal(round.hadRunoff, !!scenario.runoff);
  assert.equal(round.ballots.length, 4);
  if (scenario.winner !== undefined) {
    assert.deepEqual(round.winners, [seats[scenario.winner].id]);
    assert.equal(round.penalty, settings.penalties[0]);
  } else {
    assert.deepEqual(round.winners, []);
    assert.equal(round.noVerdictReason, scenario.reason);
    assert.equal(round.penalty, "");
    assert.deepEqual(round.completedBy, []);
  }
  check(true, scenario.label);
}
await api(path, { action: "complete", roundId: round.id }, seats[0].token, 403);
check(true, "无战犯局不能伪造完成惩罚");
const rooms = await Promise.all(seats.map((_, i) => read(i)));
check(rooms.every((room) => room.rounds.length === cases.length && room.rounds.filter((r) => r.winners.length).length === 7 && JSON.stringify(room.rounds.map((r) => [r.tally, r.winners, r.noVerdictReason])) === JSON.stringify(rooms[0].rounds.map((r) => [r.tally, r.winners, r.noVerdictReason]))), "四个身份历史一致，仅达标的七局增加背锅次数");

// 已开局旧规则和历史兼容，不需要修改云端已有房间数据。
const { code } = await transform(await readFile(new URL("../lib/game.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm", target: "node22" });
const game = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
for (const tieRule of ["shared", "random"]) {
  const model = { code: "LEG234", name: "旧房间", createdAt: new Date().toISOString(), hostId: "0", settings, rounds: [], members: ["0", "1", "2", "3"].map((id) => ({ id, name: `队员${id}`, tokenHash: "test", joinedAt: new Date().toISOString() })) };
  game.applyAction(model, model.members[0], { action: "start", settings: { ...settings, tieRule } });
  const old = model.rounds[0];
  delete old.verdictRule;
  for (const phase of ["voting", "runoff"]) for (const [i, member] of model.members.entries()) game.applyAction(model, member, { action: "vote", roundId: old.id, phase, targetId: String(i % 2) });
  assert.equal(old.winners.length, tieRule === "shared" ? 2 : 1);
  const history = structuredClone(old);
  game.applyAction(model, model.members[0], { action: "start", settings });
  assert.deepEqual(model.rounds[0], history);
  assert.equal(model.rounds[1].verdictRule, "minimum-two");
}
check(true, "旧局按锁定规则完成且不改写历史，下一局启用两票门槛");
console.log(`RESULT: ${checks} threshold checks passed, 0 failed`);
