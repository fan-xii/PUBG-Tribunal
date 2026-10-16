// 为浏览器验收提供另外三名独立成员。只用于本地验证，凭证仅保存在进程内存中。
import { setTimeout as delay } from "node:timers/promises";
const code = process.argv[2];
const abstain = process.argv.includes("--abstain");
const spread = process.argv.includes("--spread");
if (!/^[A-Z2-9]{6}$/.test(code || "")) throw new Error("用法：node tests/ui-companions.mjs 六位房间码");
const url = `${process.env.TEST_BASE_URL || "http://127.0.0.1:5173"}/api/rooms/${code}`;
const seats = await Promise.all(["马路杀手", "人体描边", "战术大师"].map(async name => {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "join", name }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error);
  return { token: data.token, id: data.room.me.id, name };
}));
console.log("三位独立成员已加入，等待房主在浏览器开启投票并提交第一票。");
const deadline = Date.now() + 180000;
while (Date.now() < deadline) {
  const room = await (await fetch(url, { headers: { Authorization: `Bearer ${seats[0].token}` } })).json();
  const round = room.rounds.at(-1);
  if (round?.phase === "voting" && round.ballotCount >= 1) {
    await Promise.all(seats.map(async s => {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` }, body: JSON.stringify({ action: "vote", roundId: round.id, phase: "voting", targetId: abstain ? null : spread ? s.id : room.hostId, reason: abstain ? "" : "战术迷路" }) });
      if (!response.ok) throw new Error((await response.json()).error);
    }));
    console.log(abstain ? "三位队员已独立弃票，浏览器应自动显示本局结果。" : "三位队员已独立提交选票，浏览器应自动显示本局结果。");
    process.exit(0);
  }
  await delay(500);
}
throw new Error("等待房主操作超时");
