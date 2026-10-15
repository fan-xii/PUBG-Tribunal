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
const created = await api("/api/rooms", { name: "理由房主", roomName: "自由理由验收" }, undefined, 201);
const path = `/api/rooms/${created.room.code}`;
const joined = await Promise.all(["队友甲", "队友乙", "队友丙"].map((name) => api(path, { action: "join", name })));
const seats = [created, ...joined].map((x) => ({ id: x.room.me.id, token: x.token }));
const settings = { mode: "anonymous", allowSelf: true, tieRule: "shared", penalties: ["报点"] };
let round;
const read = (i = 0) => api(path, undefined, seats[i].token);
async function start(overrides = {}) {
  round = (await api(path, { action: "start", settings: { ...settings, ...overrides } }, seats[0].token)).room.rounds.at(-1);
}
const vote = (i, target, reason, expected = 200) => api(path, { action: "vote", roundId: round.id, phase: round.phase, targetId: target === null ? null : seats[target].id, reason }, seats[i].token, expected);
const clean = (entries) => entries.every((entry) => Object.keys(entry).sort().join(",") === "reason,targetId");

await start();
for (const invalid of ["a".repeat(81), "a\u0000b", 12, null, {}, "a\tb"]) await vote(0, 1, invalid, 400);
check((await read()).rounds.at(-1).ballotCount === 0, "非法、超长及控制字符理由被拒绝且不消耗选票");
await vote(0, 1, "  掉队了\r\n没有跟上标点  ");
const pending = (await read(1)).rounds.at(-1);
check(pending.reasonsPublic && !pending.anonymousReasons.length && !pending.initialAnonymousReasons.length && !JSON.stringify(pending).includes("掉队了"), "匿名理由在投票期间不向其他成员泄露");
await Promise.all([vote(1, 1, "载具事故"), vote(2, 1, "载具事故"), vote(3, 0, "   ")]);
let room = await read();
let result = room.rounds.at(-1);
check(result.anonymousReasons.length === 3 && result.anonymousReasons.some((b) => b.reason === "掉队了\n没有跟上标点") && result.anonymousReasons.every((b) => b.targetId === seats[1].id), "结算公开自定义多行理由和对应被投队员，自动去除首尾空格");
check(result.anonymousReasons.filter((b) => b.reason === "载具事故").length === 2, "同样的理由按实际票数保留，空白理由不产生无意义条目");
check(clean(result.anonymousReasons) && !result.ballots.length && !result.initialBallots.length, "匿名理由只含目标与文字，没有提交者、选票 ID 或时间戳");
const snapshots = await Promise.all(seats.map((_, i) => read(i)));
check(snapshots.every((r) => JSON.stringify(r.rounds.at(-1).anonymousReasons) === JSON.stringify(result.anonymousReasons)), "房主与普通成员看到相同匿名理由和顺序");

await start();
await Promise.all([vote(0, 1, "首轮甲"), vote(1, 0, "首轮乙"), vote(2, 1, "首轮丙"), vote(3, 0, "首轮丁")]);
round = (await read()).rounds.at(-1);
check(round.phase === "runoff" && !round.anonymousReasons.length && !round.initialAnonymousReasons.length && !JSON.stringify(round).includes("首轮甲"), "首轮平票后仍隐藏全部理由，等待最终结果再公开");
await Promise.all([vote(0, null, "弃票私密文字"), vote(1, 0, "加投理由"), vote(2, 0, "加投另一个理由"), vote(3, 0, "")]);
result = (await read()).rounds.at(-1);
check(result.anonymousReasons.length === 2 && result.initialAnonymousReasons.length === 4 && clean(result.initialAnonymousReasons) && !JSON.stringify(result).includes("弃票私密文字"), "加投和首轮理由分别公开，弃票不参与投票理由列表");

await start({ mode: "named" });
const html = '<img src=x onerror="alert(1)">';
await Promise.all([vote(0, 1, html), vote(1, 1, "战术迷路"), vote(2, 1, "a".repeat(80)), vote(3, 1, "")]);
result = (await read()).rounds.at(-1);
check(result.ballots.length === 4 && result.ballots.some((b) => b.voterId === seats[0].id && b.reason === html) && result.ballots.some((b) => b.reason.length === 80) && !result.anonymousReasons.length, "实名结果保留作者和自定义文字，接受 80 字边界及普通 HTML 文字");
await start();
await vote(0, 1, "作废不公开的理由");
await api(path, { action: "cancel", roundId: round.id }, seats[0].token);
room = await read();
check(!JSON.stringify(room.rounds.at(-1)).includes("作废不公开的理由") && !room.rounds.at(-1).anonymousReasons.length, "作废局不会公开已提交理由");
check(room.rounds[0].anonymousReasons.length === 3 && room.rounds[0].mode === "anonymous" && !room.rounds[0].ballots.length, "后续实名开局不会改变历史匿名作者保护与已公开理由");

// 旧匿名局的保密承诺和输出顺序：使用真实共享逻辑检查无需云端篡改历史。
const { code } = await transform(await readFile(new URL("../lib/game.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm", target: "node22" });
const game = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const model = { code: "LEG234", name: "旧房间", createdAt: new Date().toISOString(), hostId: "0", settings, rounds: [], members: ["0", "1", "2", "3"].map((id) => ({ id, name: `队员${id}`, tokenHash: "test", joinedAt: new Date().toISOString() })) };
game.applyAction(model, model.members[0], { action: "start", settings });
const internal = model.rounds[0];
for (const m of model.members) game.applyAction(model, m, { action: "vote", roundId: internal.id, phase: "voting", targetId: "1", reason: `理由${3 - Number(m.id)}` });
const ordered = game.publicRoom(model, model.members[0]).rounds[0].anonymousReasons;
internal.votes.reverse();
check(JSON.stringify(game.publicRoom(model, model.members[1]).rounds[0].anonymousReasons) === JSON.stringify(ordered), "匿名理由输出与内部提交顺序无关，不暴露时间顺序");
delete internal.reasonDisclosure;
const legacy = game.publicRoom(model, model.members[0]).rounds[0];
check(!legacy.reasonsPublic && !legacy.anonymousReasons.length && !JSON.stringify(legacy).includes("理由"), "升级前的匿名历史继续保密，不追溯公开旧理由");
console.log(`RESULT: ${checks} reason checks passed, 0 failed`);
