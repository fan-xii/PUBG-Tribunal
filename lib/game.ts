export type Mode = "anonymous" | "named";
export type Settings = {
  mode: Mode;
  allowSelf: boolean;
  tieRule: "shared" | "random";
  penalties: string[];
};
export type Member = {
  id: string;
  name: string;
  tokenHash: string;
  joinedAt: string;
};
export type Ballot = { voterId: string; targetId: string | null; reason: string };
export type Round = {
  id: string;
  number: number;
  mode: Mode;
  allowSelf: boolean;
  tieRule: Settings["tieRule"];
  phase: "voting" | "runoff" | "result" | "cancelled";
  createdAt: string;
  finishedAt?: string;
  penalty: string;
  votes: Ballot[];
  runoff: Ballot[];
  candidates: string[];
  participantIds?: string[];
  winners: string[];
  completedBy: string[];
  randomDecided?: boolean;
};
export type Room = {
  code: string;
  name: string;
  hostId: string;
  createdAt: string;
  members: Member[];
  formerMembers?: (Pick<Member, "id" | "name" | "joinedAt"> & { removedAt: string })[];
  settings: Settings;
  rounds: Round[];
};
export const defaultSettings: Settings = {
  mode: "anonymous",
  allowSelf: true,
  tieRule: "shared",
  penalties: [
    "下一局担任专职司机",
    "用播音腔复盘本局 30 秒",
    "给队友唱一段歌",
    "下一局负责标点和报圈",
  ],
};
export class GameError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function textValue(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new GameError(`请填写${label}`);
  const result = value.trim();
  if (!result || result.length > max || /[\u0000-\u001f]/.test(result))
    throw new GameError(`${label}需要 1–${max} 个字符`);
  return result;
}
export function parseSettings(value: unknown): Settings {
  const s = value as Settings;
  if (
    !s ||
    !["anonymous", "named"].includes(s.mode) ||
    typeof s.allowSelf !== "boolean" ||
    !["shared", "random"].includes(s.tieRule)
  )
    throw new GameError("投票规则不正确");
  if (
    !Array.isArray(s.penalties) ||
    s.penalties.length < 1 ||
    s.penalties.length > 12
  )
    throw new GameError("请设置 1–12 条惩罚");
  return {
    mode: s.mode,
    allowSelf: s.allowSelf,
    tieRule: s.tieRule,
    penalties: [...new Set(s.penalties.map((p) => textValue(p, "惩罚", 60)))],
  };
}
export function randomItem<T>(items: T[]): T {
  const bound = 0x100000000 - (0x100000000 % items.length);
  let n: number;
  do {
    n = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (n >= bound);
  return items[n % items.length];
}
export function tally(room: Room, ballots: Ballot[], participantIds = room.members.map((m) => m.id)) {
  return participantIds.map((id) => ({
    memberId: id,
    count: ballots.filter((v) => v.targetId === id).length,
  }));
}
function top(room: Room, ballots: Ballot[]) {
  const counts = tally(room, ballots);
  const highest = Math.max(...counts.map((t) => t.count));
  return highest > 0 ? counts.filter((t) => t.count === highest).map((t) => t.memberId) : [];
}
export function applyAction(
  room: Room,
  member: Member,
  body: Record<string, unknown>,
) {
  const current = room.rounds.at(-1);
  if (body.action === "rename") {
    if (body.targetId !== undefined && body.targetId !== member.id)
      throw new GameError("只能修改自己的昵称", 403);
    if (current && ["voting", "runoff"].includes(current.phase))
      throw new GameError("投票进行中不能改名，请先结算或作废本轮", 409);
    const name = textValue(body.name, "昵称", 12);
    if (room.members.some((m) => m.id !== member.id && m.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
      throw new GameError("昵称已被队友使用，请换一个", 409);
    member.name = name;
    return;
  }
  if (body.action === "kick" || body.action === "transferHost") {
    if (member.id !== room.hostId)
      throw new GameError("只有房主可以管理成员", 403);
    if (body.targetId === member.id)
      throw new GameError("请选择其他队员");
    const target = room.members.find((m) => m.id === body.targetId);
    if (!target) throw new GameError("该队员已不在房间中，请刷新后重试", 409);
    if (body.action === "transferHost") {
      room.hostId = target.id;
      return;
    }
    if (current && ["voting", "runoff"].includes(current.phase))
      throw new GameError("投票进行中不能踢人，请先结算或作废本轮", 409);
    // 为旧房间补齐当局阵容，再移出成员，避免历史计票跟随当前阵容变化。
    for (const round of room.rounds)
      round.participantIds ??= room.members.map((m) => m.id);
    room.formerMembers ??= [];
    const { id, name, joinedAt } = target;
    room.formerMembers.push({ id, name, joinedAt, removedAt: new Date().toISOString() });
    room.members = room.members.filter((m) => m.id !== target.id);
    return;
  }
  if (body.action === "start") {
    if (member.id !== room.hostId)
      throw new GameError("只有房主可以开启投票", 403);
    if (room.members.length !== 4)
      throw new GameError("四位队员全部加入后才能开始", 409);
    if (current && ["voting", "runoff"].includes(current.phase))
      throw new GameError("请先完成或作废当前投票", 409);
    if (room.rounds.length >= 500)
      throw new GameError("这个房间已经完成 500 局，请创建新房间");
    room.settings = parseSettings(body.settings);
    room.rounds.push({
      id: crypto.randomUUID(),
      number: room.rounds.length + 1,
      mode: room.settings.mode,
      allowSelf: room.settings.allowSelf,
      tieRule: room.settings.tieRule,
      phase: "voting",
      createdAt: new Date().toISOString(),
      penalty: randomItem(room.settings.penalties),
      votes: [],
      runoff: [],
      candidates: room.members.map((m) => m.id),
      participantIds: room.members.map((m) => m.id),
      winners: [],
      completedBy: [],
    });
    return;
  }
  if (body.action === "complete") {
    const round = room.rounds.find((r) => r.id === body.roundId);
    if (
      !round ||
      round.phase !== "result" ||
      !round.winners.includes(member.id)
    )
      throw new GameError("只有本局战犯可以确认完成惩罚", 403);
    if (!round.completedBy.includes(member.id))
      round.completedBy.push(member.id);
    return;
  }
  if (!current || body.roundId !== current.id)
    throw new GameError("当前局次已变化，请刷新后再试", 409);
  if (!["voting", "runoff"].includes(current.phase))
    throw new GameError("本轮已结束", 409);
  if (body.action === "cancel") {
    if (member.id !== room.hostId)
      throw new GameError("只有房主可以作废本轮", 403);
    current.phase = "cancelled";
    current.finishedAt = new Date().toISOString();
    return;
  }
  if (body.action !== "vote") throw new GameError("不支持的操作");
  // 防止首轮延迟请求被误记为加投选票。
  if (body.phase !== current.phase)
    throw new GameError("投票已进入新阶段，请查看当前页面", 409);
  const ballots = current.phase === "runoff" ? current.runoff : current.votes;
  if (ballots.some((v) => v.voterId === member.id))
    throw new GameError("本轮已经提交，不能重复投票或改票", 409);
  const abstained = body.targetId === null;
  const target = room.members.find((m) => m.id === body.targetId);
  if (!abstained && (!target || !current.candidates.includes(target.id)))
    throw new GameError("请选择本轮候选队员");
  if (!abstained && !current.allowSelf && target?.id === member.id)
    throw new GameError("本局规则不允许投给自己");
  const reason =
    body.reason === undefined || body.reason === ""
      ? "未填写"
      : textValue(body.reason, "投票原因", 80);
  ballots.push({ voterId: member.id, targetId: abstained ? null : target!.id, reason });
  if (ballots.length < 4) return;
  const leaders = top(room, ballots);
  if (leaders.length > 1 && current.phase === "voting") {
    current.phase = "runoff";
    current.candidates = leaders;
    return;
  }
  current.randomDecided = leaders.length > 1 && current.tieRule === "random";
  current.winners = current.randomDecided ? [randomItem(leaders)] : leaders;
  if (!leaders.length) current.penalty = "";
  current.phase = "result";
  current.finishedAt = new Date().toISOString();
}
export function publicRoom(room: Room, member: Member) {
  const current = room.rounds.at(-1);
  return {
    code: room.code,
    name: room.name,
    createdAt: room.createdAt,
    hostId: room.hostId,
    settings: room.settings,
    members: room.members.map(({ id, name, joinedAt }) => ({
      id,
      name,
      joinedAt,
    })),
    formerMembers: (room.formerMembers || []).map(({ id, name, joinedAt, removedAt }) => ({ id, name, joinedAt, removedAt })),
    me: { id: member.id, isHost: member.id === room.hostId },
    rounds: room.rounds.map((r) => {
      const activeBallots =
        r.phase === "runoff" || r.runoff.length ? r.runoff : r.votes;
      const own =
        r.id === current?.id
          ? activeBallots.find((v) => v.voterId === member.id)
          : undefined;
      const revealed = r.phase === "result";
      return {
        id: r.id,
        number: r.number,
        mode: r.mode,
        allowSelf: r.allowSelf,
        tieRule: r.tieRule,
        phase: r.phase,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt,
        penalty: r.penalty,
        candidates: r.candidates,
        winners: r.winners,
        completedBy: r.completedBy,
        randomDecided: !!r.randomDecided,
        ballotCount: activeBallots.length,
        hadRunoff: r.runoff.length > 0 || r.phase === "runoff",
        submitted: !!own,
        myTargetId: own?.targetId,
        myAbstained: own?.targetId === null,
        // 揭晓前仅公开总提交数，不泄露其他人的弃票选择。
        abstentionCount: revealed ? activeBallots.filter((b) => b.targetId === null).length : 0,
        initialAbstentionCount:
          r.phase === "runoff" || (revealed && r.runoff.length)
            ? r.votes.filter((b) => b.targetId === null).length : 0,
        tally: revealed ? tally(room, activeBallots, r.participantIds) : [],
        initialTally:
          r.phase === "runoff" || (revealed && r.runoff.length)
            ? tally(room, r.votes, r.participantIds)
            : [],
        // 服务端删除匿名投票关系，房主和普通成员得到相同的隐私保护。
        ballots: revealed && r.mode === "named" ? activeBallots : [],
        initialBallots:
          revealed && r.mode === "named" && r.runoff.length ? r.votes : [],
      };
    }),
  };
}
export type PublicRoom = ReturnType<typeof publicRoom>;
export type PublicRound = PublicRoom["rounds"][number];
