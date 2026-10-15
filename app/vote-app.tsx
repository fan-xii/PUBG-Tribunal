"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Crosshair,
  LayoutDashboard,
  History,
  Trophy,
  ArrowUpRight,
  ArrowRight,
  Users,
  ShieldCheck,
  Radio,
  EyeOff,
  Eye,
  Plus,
  Link,
  Copy,
  Check,
  X,
  ChevronRight,
  CircleHelp,
  LogOut,
  LockKeyhole,
  Swords,
  CheckCircle2,
  TriangleAlert,
  LoaderCircle,
  Flag,
  Settings2,
  Gift,
  RotateCcw,
  Plane,
  Fingerprint,
  Pencil,
} from "lucide-react";
import {
  defaultSettings,
  type Settings,
  type PublicRoom,
  type PublicRound,
} from "@/lib/game";
type Session = { code: string; token: string };
type Modal =
  "help" | "invite" | "penalties" | "vote" | "cancel" | "recover" | "members" | "kick" | "transfer" | "rename" | null;
type View = "room" | "history" | "leaderboard";
const sessionKey = "squad-verdict-sessions-v1";
const abstainTarget = "__abstain__";
const reasons = [
  "战术迷路",
  "救援迟到",
  "载具事故",
  "枪法随缘",
  "独自冲锋",
  "我有我的理解",
];
function savedSessions(): Session[] {
  try {
    const data = JSON.parse(localStorage.getItem(sessionKey) || "[]");
    return Array.isArray(data)
      ? data.filter(
          (x) => typeof x.code === "string" && typeof x.token === "string",
        )
      : [];
  } catch {
    return [];
  }
}
function storeSession(s: Session) {
  localStorage.setItem(
    sessionKey,
    JSON.stringify(
      [s, ...savedSessions().filter((x) => x.code !== s.code)].slice(0, 20),
    ),
  );
}
function forgetSession(s: Session) {
  localStorage.setItem(sessionKey, JSON.stringify(savedSessions().filter(
    (x) => x.code !== s.code || x.token !== s.token,
  )));
}
function modeName(mode: string) {
  return mode === "anonymous" ? "匿名投票" : "实名投票";
}
function timeLabel(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function ModalFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const callback = useRef(onClose);
  callback.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    closeRef.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") callback.current();
      if (e.key === "Tab") {
        const nodes = [
          ...(dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,textarea,select,a[href]",
          ) || []),
        ];
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", listener);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <button
            ref={closeRef}
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export default function VoteApp({ economyPolling = false }: { economyPolling?: boolean } = {}) {
  const [session, setSession] = useState<Session | null>(null),
    [room, setRoom] = useState<PublicRoom | null>(null),
    [view, setView] = useState<View>("room"),
    [modal, setModal] = useState<Modal>(null);
  const [tab, setTab] = useState<"create" | "join">("create"),
    [name, setName] = useState(""),
    [roomName, setRoomName] = useState(""),
    [code, setCode] = useState("");
  const [settings, setSettings] = useState<Settings>(defaultSettings),
    [penaltyText, setPenaltyText] = useState(
      defaultSettings.penalties.join("\n"),
    );
  const [target, setTarget] = useState(""),
    [reason, setReason] = useState(""),
    [pending, setPending] = useState(false),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [connection, setConnection] = useState<
      "connected" | "offline" | "connecting"
    >("connecting");
  const [recent, setRecent] = useState<Session[]>([]),
    [recovery, setRecovery] = useState(""),
    [qr, setQr] = useState("");
  const [managedTarget, setManagedTarget] = useState("");
  const [nickname, setNickname] = useState("");
  const requestSequence = useRef(0),
    busy = useRef(false),
    phaseKey = useRef("");
  const current = room?.rounds.at(-1),
    active = !!current && ["voting", "runoff"].includes(current.phase);
  const activePolling = useRef(false);
  activePolling.current = active;
  const allMembers = room ? [...room.members, ...(room.formerMembers || [])] : [];
  const memberName = (id?: string | null) => id === null ? "弃票" :
    allMembers.find((m) => m.id === id)?.name || "队员";
  useEffect(() => {
    const all = savedSessions();
    setRecent(all);
    const requested = new URLSearchParams(location.search)
      .get("room")
      ?.toUpperCase();
    if (requested) {
      setCode(requested.slice(0, 6));
      setTab("join");
      const saved = all.find((s) => s.code === requested);
      if (saved) setSession(saved);
    } else if (all[0]) setSession(all[0]);
    setLoading(false);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  // 串行轮询；写操作递增序号，防止旧读请求覆盖提交后的状态。
  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    const interval = () => economyPolling ? (activePolling.current ? 3000 : 20000) : 1200;
    const poll = async () => {
      if (document.hidden || busy.current) {
        timer = setTimeout(poll, 1200);
        return;
      }
      controller = new AbortController();
      const seq = ++requestSequence.current;
      const timeout = setTimeout(() => controller?.abort(), 10000);
      try {
        const response = await fetch(`/api/rooms/${session.code}`, {
          headers: { Authorization: `Bearer ${session.token}` },
          signal: controller.signal,
          cache: "no-store",
        });
        const data = (await response.json()) as PublicRoom & { error?: string };
        if (stopped || seq !== requestSequence.current) return;
        if (!response.ok) {
          if ([401, 404].includes(response.status)) {
            forgetSession(session);
            setRecent(savedSessions());
            setError(data.error || "房间身份已失效");
            setModal(null);
            setSession(null);
            setRoom(null);
            return;
          }
          throw new Error(data.error);
        }
        setRoom(data);
        setConnection("connected");
      } catch {
        if (!stopped) setConnection("offline");
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(poll, interval());
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [session, economyPolling]);
  useEffect(() => {
    if (!room?.me.isHost && ["members", "kick", "transfer"].includes(modal || "")) setModal(null);
  }, [room?.me.isHost, modal]);
  useEffect(() => {
    if (!room) return;
    const key = `${room.code}:${current?.id}:${current?.phase}`;
    if (phaseKey.current !== key) {
      phaseKey.current = key;
      setTarget("");
      setReason("");
      setModal((m) => (m === "vote" || m === "cancel" ? null : m));
      setSettings(room.settings);
      setPenaltyText(room.settings.penalties.join("\n"));
    }
  }, [room, current]);
  useEffect(() => {
    if (modal !== "invite" || !room) return;
    let alive = true;
    import("qrcode-generator").then(({ default: qrcode }) => {
      const q = qrcode(0, "M");
      q.addData(`${location.origin}/?room=${room.code}`);
      q.make();
      if (alive)
        setQr(q.createSvgTag({ cellSize: 5, margin: 3, scalable: true }));
    });
    return () => {
      alive = false;
    };
  }, [modal, room?.code]);
  async function submit(
    path: string,
    body: Record<string, unknown>,
    auth?: Session,
  ) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    ++requestSequence.current;
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await response.json()) as {
        room: PublicRoom;
        token?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "提交失败，请重试");
      setRoom(data.room);
      setConnection("connected");
      if (data.token) {
        const next = { code: data.room.code, token: data.token };
        storeSession(next);
        setRecent(savedSessions());
        setSession(next);
        history.replaceState({}, "", `/?room=${next.code}`);
      }
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络连接失败，请重试");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function enter(e: FormEvent) {
    e.preventDefault();
    if (tab === "join") {
      const saved = savedSessions().find((s) => s.code === code.toUpperCase());
      if (saved) {
        setSession(saved);
        setRoom(null);
        setConnection("connecting");
        return;
      }
    }
    await submit(
      tab === "create" ? "/api/rooms" : `/api/rooms/${code.toUpperCase()}`,
      { action: "join", name, roomName },
    );
  }
  async function action(body: Record<string, unknown>) {
    if (!session) return;
    const data = await submit(`/api/rooms/${session.code}`, body, session);
    if (data) setModal(null);
  }
  async function copy(value: string, message = "已复制") {
    try {
      await navigator.clipboard.writeText(value);
      setToast(message);
    } catch {
      setError("复制失败，请手动选择并复制");
    }
  }
  async function restore(e: FormEvent) {
    e.preventDefault();
    const [restoreCode, token] = recovery.trim().split(".");
    if (!restoreCode || !token) {
      setError("请粘贴完整的席位恢复码");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/rooms/${restoreCode.toUpperCase()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as PublicRoom & { error?: string };
      if (!response.ok) throw new Error(data.error);
      const next = { code: restoreCode.toUpperCase(), token };
      storeSession(next);
      setSession(next);
      setRoom(data);
      setRecent(savedSessions());
      setModal(null);
      setRecovery("");
      setError("");
      history.replaceState({}, "", `/?room=${next.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "恢复失败");
    } finally {
      setPending(false);
    }
  }
  function leave() {
    ++requestSequence.current;
    setRoom(null);
    setSession(null);
    setView("room");
    setError("");
    history.replaceState({}, "", "/");
  }
  function nav(next: View) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            room ? nav("room") : leave();
          }}
        >
          <span className="brand-mark">
            <Crosshair size={25} />
          </span>
          <span>
            背锅小队<small>SQUAD VERDICT</small>
          </span>
        </a>
        <div className="nav-caption">小队指挥中心</div>
        <nav aria-label="主要导航">
          <button
            className={`nav-item ${view === "room" ? "selected" : ""}`}
            onClick={() => nav("room")}
          >
            <LayoutDashboard size={19} />
            作战大厅
            <span className="nav-dot" />
          </button>
          <button
            className={`nav-item ${view === "history" ? "selected" : ""}`}
            disabled={!room}
            onClick={() => nav("history")}
          >
            <History size={19} />
            对局记录
            {room && (
              <span className="nav-count">
                {
                  room.rounds.filter((r) =>
                    ["result", "cancelled"].includes(r.phase),
                  ).length
                }
              </span>
            )}
          </button>
          <button
            className={`nav-item ${view === "leaderboard" ? "selected" : ""}`}
            disabled={!room}
            onClick={() => nav("leaderboard")}
          >
            <Trophy size={19} />
            背锅排行榜
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Swords size={22} />
            <p>认真吃鸡，快乐背锅。</p>
            <small>输赢留在战场，快乐带回小队。</small>
          </div>
          <button className="nav-item" onClick={() => setModal("help")}>
            <CircleHelp size={18} />
            玩法说明
            <ArrowUpRight size={15} />
          </button>
          {room && (
            <button className="nav-item" onClick={leave}>
              <LogOut size={18} />
              返回大厅
            </button>
          )}
          <div className="sidebar-footer">
            MADE FOR YOUR SQUAD <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>PUBG</span>
            <ChevronRight size={13} />
            <span>{room ? room.name : "赛后复盘"}</span>
          </div>
          <div className="topbar-right">
            {room && (
              <button
                className="icon-button mobile-home"
                aria-label="返回作战大厅"
                onClick={leave}
              >
                <LogOut size={16} />
              </button>
            )}
            <span className="topbar-hint">四人小队 · 专属投票空间</span>
            {room ? (
              <span
                className={`status ${connection === "offline" ? "warning" : ""}`}
              >
                <i />
                {connection === "connected"
                  ? "同步正常"
                  : connection === "offline"
                    ? "重连中"
                    : "连接中"}
              </span>
            ) : (
              <Badge>
                <Radio size={12} /> READY TO DEPLOY
              </Badge>
            )}
          </div>
        </header>
        <main>
          {error && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button
                aria-label="关闭提示"
                className="icon-button"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {connection === "offline" && room && (
            <div className="connection-banner" role="status">
              连接暂时中断，正在重连。请在同步恢复后提交。
            </div>
          )}
          {loading || (session && !room) ? (
            <div className="connecting">
              <LoaderCircle className="spin" size={32} />
              <h2>正在连接小队…</h2>
              <p>读取你的席位和最新对局</p>
              <button className="button secondary" onClick={leave}>
                返回大厅
              </button>
            </div>
          ) : !room ? (
            <>
              <div className="landing-grid">
                <section className="hero">
                  <div className="eyebrow">
                    <span /> POST-MATCH DEBRIEF / 赛后复盘
                  </div>
                  <h1>
                    这局的锅，
                    <br />
                    <em>谁来背？</em>
                    <span className="title-dot">_</span>
                  </h1>
                  <p className="hero-description">
                    四个人，一场公平的赛后审判。
                    <br />
                    投票或弃票，一起决定这局谁来背锅。
                  </p>
                  <div className="hero-tags">
                    <span>
                      <Users size={15} />
                      四人专属
                    </span>
                    <span>
                      <EyeOff size={15} />
                      匿名 / 实名
                    </span>
                    <span>
                      <Radio size={15} />
                      同步揭晓
                    </span>
                  </div>
                  <div className="radar-art" aria-hidden="true">
                    <div className="radar-grid" />
                    <div className="radar-ring one" />
                    <div className="radar-ring two" />
                    <div className="radar-axis" />
                    <Crosshair className="radar-center" size={43} />
                    <Plane className="radar-plane" size={26} />
                    <span className="radar-tag">SQUAD 04</span>
                    <span className="radar-coordinate">
                      35°42′ N &nbsp; 51°24′ E
                    </span>
                    <span className="map-label">ERANGEL / DEBRIEF ZONE</span>
                  </div>
                  <div className="hero-bottom">
                    <span>+</span> GOOD GAME. NOW, FACE THE VERDICT.
                  </div>
                </section>
                <section className="entry-panel">
                  <div className="panel-topline">
                    <span className="section-index">01 / ASSEMBLE</span>
                    <Users size={19} />
                  </div>
                  <h2>小队集结</h2>
                  <p className="muted">从这里开始今晚的快乐背锅之旅。</p>
                  <div className="segmented" role="group" aria-label="房间操作">
                    <button
                      aria-pressed={tab === "create"}
                      onClick={() => {
                        setTab("create");
                        setError("");
                      }}
                    >
                      <Plus size={15} />
                      创建房间
                    </button>
                    <button
                      aria-pressed={tab === "join"}
                      onClick={() => {
                        setTab("join");
                        setError("");
                      }}
                    >
                      <Link size={15} />
                      加入房间
                    </button>
                  </div>
                  <form onSubmit={enter}>
                    <label className="field">
                      你的游戏昵称
                      <input
                        placeholder="今晚怎么称呼你？"
                        autoComplete="nickname"
                        value={name}
                        maxLength={12}
                        required
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    {tab === "create" ? (
                      <label className="field">
                        小队名称 <span className="optional">选填</span>
                        <input
                          placeholder="今晚吃鸡小分队"
                          value={roomName}
                          maxLength={24}
                          onChange={(e) => setRoomName(e.target.value)}
                        />
                      </label>
                    ) : (
                      <label className="field">
                        六位房间码
                        <input
                          className="code-input"
                          placeholder="例如 A3K7M9"
                          value={code}
                          maxLength={6}
                          pattern="[A-Za-z2-9]{6}"
                          required
                          onChange={(e) =>
                            setCode(
                              e.target.value
                                .toUpperCase()
                                .replace(/[^A-Z2-9]/g, ""),
                            )
                          }
                        />
                      </label>
                    )}
                    <button className="button primary full" disabled={pending}>
                      {pending ? (
                        <LoaderCircle className="spin" size={18} />
                      ) : (
                        <>
                          {tab === "create" ? "创建我的小队" : "加入小队"}
                          <ArrowRight size={18} />
                        </>
                      )}
                    </button>
                  </form>
                  <div className="entry-footnote">
                    <ShieldCheck size={14} />
                    无需注册 · 房间码邀请 · 满员锁定席位
                  </div>
                  {recent.length > 0 && (
                    <button
                      className="text-button recent-room"
                      onClick={() => {
                        setSession(recent[0]);
                        setConnection("connecting");
                        setError("");
                      }}
                    >
                      返回房间 {recent[0].code}
                      <ArrowRight size={14} />
                    </button>
                  )}
                  <button
                    className="text-button recover-link"
                    onClick={() => {
                      setError("");
                      setModal("recover");
                    }}
                  >
                    <Fingerprint size={14} />
                    使用恢复码找回席位
                  </button>
                </section>
              </div>
              <section className="feature-strip">
                <Feature
                  icon={<EyeOff />}
                  number="01"
                  title="想匿名，就匿名"
                  text="只看票数不看身份，或者直接实名对线。"
                />
                <Feature
                  icon={<Radio />}
                  number="02"
                  title="四票齐，才揭晓"
                  text="先独立判断，再一起见证本局背锅王。"
                />
                <Feature
                  icon={<History />}
                  number="03"
                  title="每一口锅，都有记录"
                  text="对局历史与背锅排行，今晚谁也跑不了。"
                />
              </section>
              <div className="landing-footer">
                <span>
                  <span className="live-dot" />
                  为每一支有故事的小队而造
                </span>
                <button
                  className="text-button"
                  onClick={() => setModal("help")}
                >
                  第一次来？了解玩法
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="room-heading">
                <div>
                  <div className="eyebrow">
                    SQUAD DEBRIEF /{" "}
                    {view === "room"
                      ? "战队房间"
                      : view === "history"
                        ? "对局档案"
                        : "荣誉榜单"}
                  </div>
                  <h1>
                    {view === "room"
                      ? "小队已就位，准备开庭。"
                      : view === "history"
                        ? "每一局，都有迹可循。"
                        : "今晚的锅，都在这里。"}
                  </h1>
                  <p className="muted">
                    {room.name}
                    <span className="dot-separator">·</span>房间码{" "}
                    <button
                      className="inline-code"
                      onClick={() => copy(room.code, "房间码已复制")}
                    >
                      {room.code}
                      <Copy size={12} />
                    </button>
                  </p>
                </div>
                <div className="room-actions">
                  <button className="button secondary" onClick={() => {
                    setNickname(memberName(room.me.id)); setError(""); setModal("rename");
                  }}><Pencil size={16} />修改昵称</button>
                  {room.me.isHost && <button className="button secondary" onClick={() => { setError(""); setModal("members"); }}>
                    <Settings2 size={16} />管理成员
                  </button>}
                  <button className="button secondary" onClick={() => setModal("invite")}>
                    <Users size={16} />邀请队友<ArrowUpRight size={15} />
                  </button>
                </div>
              </div>
              <div className="stats-row">
                <Stat
                  label="小队成员"
                  value={`${room.members.length}`}
                  suffix="/ 4"
                  icon={<Users />}
                />
                <Stat
                  label="已结算对局"
                  value={`${room.rounds.filter((r) => r.phase === "result").length}`}
                  suffix="局"
                  icon={<Flag />}
                />
                <Stat
                  label="我的背锅次数"
                  value={`${room.rounds.filter((r) => r.phase === "result" && r.winners.includes(room.me.id)).length}`}
                  suffix="次"
                  icon={<Trophy />}
                />
                <div className="stats-note">
                  <ShieldCheck size={25} />
                  <div>
                    规则开局锁定<small>独立投票，统一揭晓</small>
                  </div>
                </div>
              </div>
              {view === "room" ? (
                <div className="room-grid">
                  <div className="main-column">
                    <section className="panel voting-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="section-index">
                            {current
                              ? `ROUND ${String(current.number).padStart(2, "0")}`
                              : "WAITING ROOM"}
                          </span>
                          <h2>
                            {!current
                              ? room.members.length === 4
                                ? "四人集结，随时开庭"
                                : "等待小队集结"
                              : current.phase === "result"
                                ? "本局判决已出炉"
                                : current.phase === "cancelled"
                                  ? "本轮投票已作废"
                                  : current.phase === "runoff"
                                    ? "票数打平，再投一轮"
                                    : "投出你的关键一票"}
                          </h2>
                        </div>
                        {current && (
                          <Badge tone={active ? "amber" : "green"}>
                            {active ? (
                              <Radio size={12} />
                            ) : (
                              <CheckCircle2 size={12} />
                            )}{" "}
                            {active ? "投票进行中" : "本轮已结束"}
                          </Badge>
                        )}
                      </div>
                      {!current ? (
                        <>
                          <p className="muted">
                            {room.members.length === 4
                              ? "全员已经就位，房主可以在投票设置中开启第一局。"
                              : `再邀请 ${4 - room.members.length} 位队友加入，房主即可发起第一局投票。`}
                          </p>
                          <div className="member-grid waiting">
                            {[0, 1, 2, 3].map((i) => (
                              <div
                                className={`member-card ${!room.members[i] ? "empty" : ""}`}
                                key={i}
                              >
                                {room.members[i] ? (
                                  <>
                                    <span className={`avatar avatar-${i}`}>
                                      {room.members[i].name.slice(0, 1)}
                                    </span>
                                    <div>
                                      <strong>{room.members[i].name}</strong>
                                      <small>
                                        {room.members[i].id === room.hostId
                                          ? "房主 · 已就位"
                                          : "队员 · 已就位"}
                                      </small>
                                    </div>
                                    <Check size={16} className="ready-check" />
                                  </>
                                ) : (
                                  <>
                                    <span className="empty-avatar">
                                      <Plus size={21} />
                                    </span>
                                    <div>
                                      <strong>等待队友</strong>
                                      <small>席位 0{i + 1}</small>
                                    </div>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="lobby-callout">
                            <Link size={18} />
                            <div>
                              <strong>把房间链接发给你的队友</strong>
                              <p>
                                每人使用自己的浏览器加入，手机和电脑都可以。
                              </p>
                            </div>
                            <button
                              className="text-button"
                              onClick={() => setModal("invite")}
                            >
                              邀请
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        </>
                      ) : current.phase === "result" ? (
                        <RoundResult
                          round={current}
                          room={room}
                          onComplete={() =>
                            action({ action: "complete", roundId: current.id })
                          }
                          pending={pending}
                        />
                      ) : current.phase === "cancelled" ? (
                        <div className="empty-state">
                          <RotateCcw size={34} />
                          <h3>这一局不计入背锅榜</h3>
                          <p>选票保持隐藏，房主可以开启下一局。</p>
                        </div>
                      ) : (
                        <>
                          <div className="round-meta">
                            <span>
                              {current.mode === "anonymous" ? (
                                <EyeOff size={15} />
                              ) : (
                                <Eye size={15} />
                              )}{" "}
                              {modeName(current.mode)}
                            </span>
                            <span>
                              {current.allowSelf ? "允许自首" : "不可投自己"}
                            </span>
                            <span>提交后不可改票</span>
                          </div>
                          {current.phase === "runoff" && (
                            <div className="runoff-banner">
                              <Swords size={19} />
                              <div>
                                首轮并列：
                                {current.candidates.map(memberName).join("、")}
                                <small>
                                  四人重新投票，可选并列队员或弃票。全员弃票则无人背锅，仍平票则
                                  {current.tieRule === "shared"
                                    ? "并列者共同受罚"
                                    : "在并列者中随机抽取一人"}
                                  。
                                </small>
                              </div>
                            </div>
                          )}
                          <div className="member-grid">
                            {room.members.map((m, i) => (
                              <button
                                key={m.id}
                                className={`member-card ballot-card ${target === m.id || current.myTargetId === m.id ? "chosen" : ""}`}
                                disabled={
                                  !current.candidates.includes(m.id) ||
                                  (!current.allowSelf && m.id === room.me.id) ||
                                  current.submitted
                                }
                                onClick={() => setTarget(m.id)}
                                aria-pressed={
                                  target === m.id || current.myTargetId === m.id
                                }
                              >
                                <span className={`avatar avatar-${i}`}>
                                  {m.name.slice(0, 1)}
                                </span>
                                <div>
                                  <strong>
                                    {m.name}
                                    {m.id === room.me.id && (
                                      <span className="self-tag">我</span>
                                    )}
                                  </strong>
                                  <small>
                                    {!current.candidates.includes(m.id)
                                      ? "本轮不在候选中"
                                      : m.id === room.hostId
                                        ? "小队房主"
                                        : `队员 0${i + 1}`}
                                  </small>
                                </div>
                                <span className="select-circle">
                                  {(target === m.id ||
                                    current.myTargetId === m.id) && (
                                    <Check size={13} />
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                          <button
                            className={`member-card ballot-card abstain-card ${target === abstainTarget || current.myAbstained ? "chosen" : ""}`}
                            disabled={current.submitted}
                            aria-pressed={target === abstainTarget || current.myAbstained}
                            onClick={() => { setTarget(abstainTarget); setReason(""); }}
                          >
                            <span className="avatar"><ShieldCheck size={23} /></span>
                            <div><strong>弃票 · 这局不甩锅</strong><small>不投给任何队员，仍计入提交进度</small></div>
                            <span className="select-circle">{(target === abstainTarget || current.myAbstained) && <Check size={13} />}</span>
                          </button>
                          {!current.submitted ? (
                            <>
                              {target === abstainTarget ? <p className="muted abstain-note">全员弃票时，本局无人背锅，也不执行惩罚。</p> : <>
                              <div className="reason-label">
                                背锅理由{" "}
                                <span className="optional">
                                  选填
                                  {current.mode === "anonymous"
                                    ? " · 匿名局不公开理由"
                                    : ""}
                                </span>
                              </div>
                              <div className="reason-chips">
                                {reasons.map((r) => (
                                  <button
                                    key={r}
                                    aria-pressed={reason === r}
                                    onClick={() =>
                                      setReason(reason === r ? "" : r)
                                    }
                                  >
                                    {r}
                                  </button>
                                ))}
                              </div>
                              </>}
                              <button
                                className="button primary full submit-vote"
                                disabled={
                                  !target ||
                                  pending ||
                                  connection !== "connected"
                                }
                                onClick={() => setModal("vote")}
                              >
                                {target === abstainTarget ? <ShieldCheck size={17} /> : <Crosshair size={17} />}
                                {target === abstainTarget ? "提交弃票" : target
                                  ? `投给 ${memberName(target)}`
                                  : "选择队员或弃票"}
                                <ArrowRight size={18} />
                              </button>
                            </>
                          ) : (
                            <div className="submitted">
                              <CheckCircle2 size={27} />
                              <div>
                                <strong>你的选票已封存</strong>
                                <p>
                                  {current.myAbstained ? "已弃票" : `已投给 ${memberName(current.myTargetId)}`}
                                  ，等待全员提交后揭晓。
                                </p>
                              </div>
                            </div>
                          )}
                          <div className="vote-progress" aria-live="polite">
                            <span>本轮提交进度</span>
                            <strong>
                              {current.ballotCount}
                              <span> / 4</span>
                            </strong>
                          </div>
                          <div
                            className="progress-track"
                            role="progressbar"
                            aria-label="提交进度"
                            aria-valuenow={current.ballotCount}
                            aria-valuemin={0}
                            aria-valuemax={4}
                          >
                            <span
                              style={{ width: `${current.ballotCount * 25}%` }}
                            />
                          </div>
                          <p className="privacy-note">
                            <LockKeyhole size={13} />
                            揭晓前不显示票数和其他人的投票选择。
                          </p>
                        </>
                      )}
                    </section>
                    <div className="fair-play-note">
                      <ShieldCheck size={18} />
                      <p>
                        <strong>背锅有据，玩笑有度。</strong>{" "}
                        惩罚请提前达成共识，快乐才是小队的最终胜利。
                      </p>
                    </div>
                  </div>
                  <aside className="right-column">
                    <section className="panel rules-panel">
                      <div className="panel-heading">
                        <h2>
                          <Settings2 size={18} />
                          {active ? "本局规则" : "下一局设置"}
                        </h2>
                        {active && <LockKeyhole size={15} />}
                      </div>
                      <label className="form-caption">投票方式</label>
                      <div className="segmented">
                        <button
                          disabled={!room.me.isHost || active}
                          aria-pressed={
                            (active ? current.mode : settings.mode) ===
                            "anonymous"
                          }
                          onClick={() =>
                            setSettings({ ...settings, mode: "anonymous" })
                          }
                        >
                          <EyeOff size={14} />
                          匿名
                        </button>
                        <button
                          disabled={!room.me.isHost || active}
                          aria-pressed={
                            (active ? current.mode : settings.mode) === "named"
                          }
                          onClick={() =>
                            setSettings({ ...settings, mode: "named" })
                          }
                        >
                          <Eye size={14} />
                          实名
                        </button>
                      </div>
                      <p className="settings-help">
                        {(active ? current.mode : settings.mode) === "anonymous"
                          ? "只公开得票数，不公开谁投给谁。"
                          : "结算后公开谁投给谁及投票理由。"}
                      </p>
                      <label className="switch-row">
                        <span>
                          允许投给自己<small>勇于自首也是一种担当</small>
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={
                            active ? current.allowSelf : settings.allowSelf
                          }
                          disabled={!room.me.isHost || active}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              allowSelf: e.target.checked,
                            })
                          }
                        />
                      </label>
                      <label className="field small-field">
                        加投后仍平票
                        <select
                          value={active ? current.tieRule : settings.tieRule}
                          disabled={!room.me.isHost || active}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              tieRule: e.target.value as Settings["tieRule"],
                            })
                          }
                        >
                          <option value="shared">并列者共同背锅</option>
                          <option value="random">并列者随机抽取一人</option>
                        </select>
                      </label>
                      <div className="rules-divider" />
                      <div className="penalty-header">
                        <span>
                          <Gift size={16} />
                          {active ? "本局惩罚" : "惩罚清单"}
                        </span>
                        {!active && room.me.isHost && (
                          <button
                            className="text-button"
                            onClick={() => setModal("penalties")}
                          >
                            编辑
                            <ChevronRight size={13} />
                          </button>
                        )}
                      </div>
                      {active ? (
                        <p className="current-penalty">{current.penalty}</p>
                      ) : (
                        <>
                          <p className="settings-help">
                            开局从 {settings.penalties.length}{" "}
                            条约定中随机选一条。
                          </p>
                          <ul className="penalty-preview">
                            {settings.penalties.slice(0, 3).map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                        </>
                      )}
                      {room.me.isHost ? (
                        active ? (
                          <button
                            className="button subtle full"
                            disabled={pending}
                            onClick={() => setModal("cancel")}
                          >
                            作废本轮
                          </button>
                        ) : (
                          <button
                            className="button primary full"
                            disabled={
                              pending ||
                              room.members.length !== 4 ||
                              connection !== "connected"
                            }
                            onClick={() =>
                              action({ action: "start", settings })
                            }
                          >
                            {pending ? (
                              <LoaderCircle className="spin" size={17} />
                            ) : (
                              <>
                                <Plus size={17} />
                                开启第 {(current?.number || 0) + 1} 局投票
                                <ArrowRight size={17} />
                              </>
                            )}
                          </button>
                        )
                      ) : (
                        <div className="host-wait">
                          <LockKeyhole size={14} />
                          {active ? "本局规则已锁定" : "等待房主开启下一局"}
                        </div>
                      )}
                      {!active && room.members.length !== 4 && (
                        <p className="settings-help centered">
                          还差 {4 - room.members.length} 位队友，即可开始
                        </p>
                      )}
                    </section>
                    <section className="room-tip">
                      <span className="section-index">SQUAD TIP</span>
                      <h3>锅可以背，友谊别碎。</h3>
                      <p>
                        投的是这局表现，
                        <br />
                        不是一起开黑的交情。
                      </p>
                      <Swords size={45} aria-hidden="true" />
                    </section>
                  </aside>
                </div>
              ) : view === "history" ? (
                <section className="panel history-panel">
                  <div className="panel-heading">
                    <h2>对局记录</h2>
                    <Badge>
                      共{" "}
                      {
                        room.rounds.filter((r) =>
                          ["result", "cancelled"].includes(r.phase),
                        ).length
                      }{" "}
                      局
                    </Badge>
                  </div>
                  {room.rounds.filter((r) =>
                    ["result", "cancelled"].includes(r.phase),
                  ).length === 0 ? (
                    <div className="empty-state">
                      <History size={38} />
                      <h3>故事才刚刚开始</h3>
                      <p>完成第一轮投票后，这里会留下小队的判决记录。</p>
                      <button
                        className="button secondary"
                        onClick={() => nav("room")}
                      >
                        返回投票
                      </button>
                    </div>
                  ) : (
                    [...room.rounds]
                      .reverse()
                      .filter((r) => ["result", "cancelled"].includes(r.phase))
                      .map((r) => (
                        <details className="history-item" key={r.id}>
                          <summary>
                            <span className="history-round">
                              {String(r.number).padStart(2, "0")}
                            </span>
                            <div>
                              <strong>
                                {r.phase === "cancelled"
                                  ? "本局已作废"
                                  : r.winners.length ? `${r.winners.map(memberName).join("、")} 背锅` : "本局无人背锅"}
                              </strong>
                              <small>
                                {timeLabel(r.finishedAt || r.createdAt)} ·{" "}
                                {modeName(r.mode)}
                                {r.hadRunoff ? " · 平票加投" : ""}
                              </small>
                            </div>
                            <Badge
                              tone={r.phase === "cancelled" ? "" : "amber"}
                            >
                              {r.phase === "cancelled"
                                ? "不计入统计"
                                : !r.winners.length ? "无需惩罚" : r.winners.every((w) =>
                                      r.completedBy.includes(w),
                                    )
                                  ? "惩罚已完成"
                                  : "惩罚待完成"}
                            </Badge>
                            <ChevronRight size={17} />
                          </summary>
                          <div className="history-detail">
                            {r.phase === "cancelled" ? (
                              <p className="muted">
                                本轮选票保持隐藏，不产生惩罚。
                              </p>
                            ) : (
                              <RoundResult
                                room={room}
                                round={r}
                                onComplete={() =>
                                  action({ action: "complete", roundId: r.id })
                                }
                                pending={pending}
                              />
                            )}
                          </div>
                        </details>
                      ))
                  )}
                </section>
              ) : (
                <section className="panel leaderboard-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="section-index">WALL OF FAME</span>
                      <h2>背锅荣誉榜</h2>
                    </div>
                    <Trophy size={25} />
                  </div>
                  <p className="muted">
                    按当选次数排名，同次数并列。仅统计已结算对局。
                  </p>
                  <div className="leaderboard">
                    {[...allMembers]
                      .map((m) => ({
                        ...m,
                        count: room.rounds.filter(
                          (r) =>
                            r.phase === "result" && r.winners.includes(m.id),
                        ).length,
                        done: room.rounds.filter(
                          (r) =>
                            r.phase === "result" &&
                            r.completedBy.includes(m.id),
                        ).length,
                      }))
                      .sort((a, b) => b.count - a.count)
                      .map((m, i, list) => (
                        <div className="leader-row" key={m.id}>
                          <span
                            className={`rank ${i === 0 && m.count > 0 ? "first" : ""}`}
                          >
                            {1 + list.filter((x) => x.count > m.count).length}
                          </span>
                          <span
                            className={`avatar avatar-${allMembers.findIndex((x) => x.id === m.id) % 4}`}
                          >
                            {m.name.slice(0, 1)}
                          </span>
                          <div>
                            <strong>
                              {m.name}
                              {!room.members.some((x) => x.id === m.id) && <span className="self-tag">已离队</span>}
                              {m.id === room.me.id && (
                                <span className="self-tag">我</span>
                              )}
                            </strong>
                            <small>已完成 {m.done} 次惩罚</small>
                          </div>
                          <strong className="leader-count">
                            {m.count}
                            <small>次背锅</small>
                          </strong>
                        </div>
                      ))}
                  </div>
                  {room.rounds.every((r) => r.phase !== "result") && (
                    <p className="settings-help centered">
                      还没有背锅记录，每个人都清清白白。
                    </p>
                  )}
                </section>
              )}
              <footer className="room-footer">
                <span>
                  SQUAD VERDICT <b> / </b> GOOD GAME, GOOD FRIENDS.
                </span>
                <button
                  className="text-button"
                  onClick={() => setModal("help")}
                >
                  玩法说明
                  <CircleHelp size={13} />
                </button>
              </footer>
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <ModalFrame
          title={
            modal === "members" ? "管理小队成员"
            : modal === "rename" ? "修改我的昵称"
            : modal === "kick" ? "确认移出队员"
            : modal === "transfer" ? "确认转移房主"
            : modal === "help"
              ? "开庭之前，先了解玩法"
              : modal === "invite"
                ? "邀请队友集结"
                : modal === "penalties"
                  ? "编辑惩罚清单"
                  : modal === "vote"
                    ? "确认提交选票"
                    : modal === "recover"
                      ? "恢复你的专属席位"
                      : "作废本轮投票"
          }
          onClose={() => setModal(null)}
        >
          {modal === "rename" && room ? (
            <form onSubmit={async (e) => {
              e.preventDefault();
              await action({ action: "rename", name: nickname });
            }}>
              <p className="muted">只修改你在当前房间的昵称。席位、房主身份、恢复码和历史统计都保留，历史记录也会显示新昵称。</p>
              {active && <div className="info-note">投票进行中，请在本轮结算或作废后修改昵称。</div>}
              <label className="field">
                新昵称
                <input value={nickname} onChange={(e) => setNickname(e.target.value)}
                  required maxLength={12} autoComplete="off" disabled={pending || active} />
              </label>
              <p className="muted">1–12 个字符，不能与当前队友重名。</p>
              <button className="button primary full" disabled={pending || active || !nickname.trim()}>
                {pending ? "正在保存…" : "保存昵称"}
              </button>
            </form>
          ) : modal === "members" && room?.me.isHost ? (
            <>
              <p className="muted">转移后你将成为普通队员。踢人会释放席位，历史记录继续保留。</p>
              {active && <div className="info-note">投票进行中，请先结算或作废本轮后再踢人。</div>}
              <div className="management-list">
                {room.members.map((m) => <div className="management-row" key={m.id}>
                  <div><strong>{m.name}</strong><small>{m.id === room.hostId ? "房主 · 我" : "小队成员"}</small></div>
                  {m.id !== room.me.id && <div className="management-actions">
                    <button className="button secondary" disabled={pending} onClick={() => { setManagedTarget(m.id); setError(""); setModal("transfer"); }}>转移房主</button>
                    <button className="button danger" disabled={pending || active} onClick={() => { setManagedTarget(m.id); setError(""); setModal("kick"); }}>踢出房间</button>
                  </div>}
                </div>)}
              </div>
            </>
          ) : (modal === "kick" || modal === "transfer") && room?.me.isHost ? (
            <>
              <p className="muted">{modal === "kick"
                ? `将「${memberName(managedTarget)}」移出房间？其旧凭证和恢复码立即失效，空位可重新邀请队友加入，已有对局和票数不会被删除。持有房间链接的人仍可重新加入空位。`
                : `将房主转移给「${memberName(managedTarget)}」？对方将拥有开局、作废、踢人和转移权限，你将成为普通队员。`}</p>
              <div className="management-actions confirm-actions">
                <button className="button secondary" disabled={pending} onClick={() => { setError(""); setModal("members"); }}>返回</button>
                <button className={`button ${modal === "kick" ? "danger" : "primary"}`} disabled={pending || (modal === "kick" && active)} onClick={() => action({ action: modal === "kick" ? "kick" : "transferHost", targetId: managedTarget })}>
                  {pending ? "正在提交…" : modal === "kick" ? "确认踢出" : "确认转移"}
                </button>
              </div>
            </>
          ) : modal === "help" ? (
            <>
              <ol className="help-steps">
                <li>
                  <strong>创建房间，四人集结</strong>
                  <p>
                    分享链接或房间码，四人分别使用自己的浏览器加入。席位绑定浏览器，可备份恢复码后换设备。
                  </p>
                </li>
                <li>
                  <strong>房主定规则，开启本局</strong>
                  <p>
                    提前选择匿名或实名、是否允许自首、平票处理和惩罚清单。开局后本局规则锁定。
                  </p>
                </li>
                <li>
                  <strong>每人一票，统一揭晓</strong>
                  <p>
                    每人可投给一位队员或选择弃票。四人全部提交后公开结果，全员弃票则本局无人背锅、无需惩罚。匿名局隐藏选择与理由；实名局公开投票或弃票的明细。
                  </p>
                </li>
                <li>
                  <strong>平票加投，留下战绩</strong>
                  <p>
                    四人对并列队员加投一次，仍平票则按开局规则共同受罚或随机抽取。战犯可以确认完成惩罚。
                  </p>
                </li>
              </ol>
              <div className="info-note">
                匿名是向其他队员和房主隐藏投票关系，服务端仍保存选票用于计票。四人场景也可能从聊天和票数推测身份。
              </div>
              <button
                className="button primary full"
                onClick={() => setModal(null)}
              >
                明白了，快乐背锅
              </button>
            </>
          ) : modal === "invite" && room && session ? (
            <>
              <p className="muted">分享给另外三位队友，每个人各占一个席位。</p>
              <div className="invite-layout">
                <div
                  className="qr-code"
                  role="img"
                  aria-label="房间邀请二维码"
                  dangerouslySetInnerHTML={{ __html: qr }}
                />
                <div>
                  <span className="form-caption">六位房间码</span>
                  <div className="invite-code">{room.code}</div>
                  <button
                    className="text-button"
                    onClick={() => copy(room.code, "房间码已复制")}
                  >
                    <Copy size={14} />
                    复制房间码
                  </button>
                </div>
              </div>
              <button
                className="button primary full"
                onClick={() =>
                  copy(
                    `${location.origin}/?room=${room.code}`,
                    "邀请链接已复制，发给队友即可",
                  )
                }
              >
                <Link size={17} />
                复制邀请链接
              </button>
              <div className="backup-section">
                <strong>
                  <Fingerprint size={16} />
                  我的席位恢复码
                </strong>
                <p>
                  换设备前备份。恢复码代表你的身份，请自己保管，勿发给队友。
                </p>
                <button
                  className="button secondary full"
                  onClick={() =>
                    copy(
                      `${session.code}.${session.token}`,
                      "私人恢复码已复制，请妥善保管",
                    )
                  }
                >
                  <Copy size={15} />
                  复制我的私人恢复码
                </button>
              </div>
            </>
          ) : modal === "penalties" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const entries = [
                  ...new Set(
                    penaltyText
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  ),
                ];
                if (
                  entries.length < 1 ||
                  entries.length > 12 ||
                  entries.some((s) => s.length > 60)
                ) {
                  setError("请输入 1–12 条惩罚，每条不超过 60 字");
                  return;
                }
                setSettings({ ...settings, penalties: entries });
                setModal(null);
                setToast("清单已更新，将在下一局生效");
              }}
            >
              <p className="muted">每行一条，开局随机抽取一条并向全员展示。</p>
              <label className="field">
                小队约定
                <textarea
                  rows={7}
                  value={penaltyText}
                  maxLength={731}
                  onChange={(e) => setPenaltyText(e.target.value)}
                  required
                />
              </label>
              <div className="info-note">
                建议选择轻松、有趣且所有队员认可的惩罚。
              </div>
              <button className="button primary full">保存清单</button>
            </form>
          ) : modal === "vote" && current ? (
            <>
              <div className="confirm-target">
                {target === abstainTarget ? <ShieldCheck size={30} /> : <Crosshair size={30} />}
                <span>
                  {target === abstainTarget ? <>你选择<strong>弃票 · 不投给任何人</strong></> : <>你将投给<strong>{memberName(target)}</strong></>}
                </span>
              </div>
              <p className="muted">
                {modeName(current.mode)} · 提交后不可修改。
                {current.mode === "named"
                  ? "你的选择和理由将在结算后对全员公开。"
                  : "结算后只公开汇总票数。"}
              </p>
              {reason && <p className="confirm-reason">理由：{reason}</p>}
              <button
                className="button primary full"
                disabled={pending || connection !== "connected"}
                onClick={() =>
                  action({
                    action: "vote",
                    roundId: current.id,
                    phase: current.phase,
                    targetId: target === abstainTarget ? null : target,
                    reason,
                  })
                }
              >
                {pending ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <>
                    <Check size={17} />
                    {target === abstainTarget ? "确认弃票" : "确认投票"}
                  </>
                )}
              </button>
            </>
          ) : modal === "cancel" && current ? (
            <>
              <p className="muted">
                第 {current.number}{" "}
                局将不产生战犯和惩罚，选票保持隐藏。该操作不可撤回。
              </p>
              <button
                className="button danger full"
                disabled={pending}
                onClick={() =>
                  action({ action: "cancel", roundId: current.id })
                }
              >
                {pending ? "正在作废…" : "确认作废本轮"}
              </button>
            </>
          ) : modal === "recover" ? (
            <form onSubmit={restore}>
              <p className="muted">
                粘贴之前在房间邀请窗口中备份的私人恢复码，回到原来的席位。
              </p>
              <label className="field">
                私人恢复码
                <textarea
                  rows={3}
                  required
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                  placeholder="六位房间码.私人凭证"
                  autoComplete="off"
                />
              </label>
              <button className="button primary full" disabled={pending}>
                {pending ? "正在恢复…" : "恢复席位"}
                <ArrowRight size={17} />
              </button>
            </form>
          ) : null}
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
        </ModalFrame>
      )}
    </div>
  );
}
function Feature({
  icon,
  number,
  title,
  text,
}: {
  icon: ReactNode;
  number: string;
  title: string;
  text: string;
}) {
  return (
    <div className="feature">
      <span className="feature-icon">{icon}</span>
      <span className="feature-number">{number}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Stat({
  label,
  value,
  suffix,
  icon,
}: {
  label: string;
  value: string;
  suffix: string;
  icon: ReactNode;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <div>
        <strong>{value}</strong>
        <small>{suffix}</small>
      </div>
      <span className="stat-icon">{icon}</span>
    </div>
  );
}
function RoundResult({
  round: r,
  room,
  onComplete,
  pending,
}: {
  round: PublicRound;
  room: PublicRoom;
  onComplete: () => void;
  pending: boolean;
}) {
  const name = (id: string | null) => id === null ? "弃票" :
    [...room.members, ...(room.formerMembers || [])].find((m) => m.id === id)?.name || "队员";
  const noVerdict = r.winners.length === 0;
  return (
    <div className="round-result">
      <div className="verdict">
        <span className="verdict-symbol">
          {noVerdict ? <ShieldCheck size={31} /> : <Trophy size={31} />}
        </span>
        <span className="section-index">
          {noVerdict ? "全员弃票 / NO VERDICT" : r.winners.length > 1
            ? "共同背锅 / SHARED VERDICT"
            : "本局战犯 / THE VERDICT"}
        </span>
        <h3>{noVerdict ? "本局无人背锅" : r.winners.map(name).join(" & ")}</h3>
        <p>
          {noVerdict ? "四位队员全部弃票，这局不安排惩罚。" : r.randomDecided
            ? "加投仍平票，按开局规则随机抽取。"
            : r.winners.length > 1
              ? "加投仍平票，这口锅一起背。"
              : "四票落定，本局背锅人正式诞生。"}
        </p>
      </div>
      <div className="result-bars">
        {[...r.tally]
          .sort((a, b) => b.count - a.count)
          .map((t) => (
            <div
              className={`result-bar-row ${r.winners.includes(t.memberId) ? "winner" : ""}`}
              key={t.memberId}
            >
              <span>
                {name(t.memberId)}
                {r.winners.includes(t.memberId) && <Trophy size={13} />}
              </span>
              <div className="result-track">
                <i style={{ width: `${t.count * 25}%` }} />
              </div>
              <strong>
                {t.count}
                <small> 票</small>
              </strong>
            </div>
          ))}
      </div>
      <p className="abstention-summary">{r.hadRunoff ? "加投" : "本轮"}弃票 <strong>{r.abstentionCount || 0}</strong> 票</p>
      {r.hadRunoff && (
        <div className="initial-tally">
          首轮：
          {r.initialTally
            .map((t) => `${name(t.memberId)} ${t.count}票`)
            .join(" / ")}
          {` / 弃票 ${r.initialAbstentionCount || 0}票`}
          <span>以上票数为加投结果</span>
        </div>
      )}
      <div className="result-penalty">
        {noVerdict ? <ShieldCheck size={21} /> : <Gift size={21} />}
        <div>
          <span>{noVerdict ? "本局结果" : "本局惩罚"}</span>
          <strong>{noVerdict ? "无需惩罚" : r.penalty}</strong>
          <small>
            {r.winners
              .map(
                (id) =>
                  `${name(id)}：${r.completedBy.includes(id) ? "已完成" : "待完成"}`,
              )
              .join(" · ")}
          </small>
        </div>
      </div>
      {r.winners.includes(room.me.id) &&
        !r.completedBy.includes(room.me.id) && (
          <button
            className="button secondary full"
            disabled={pending}
            onClick={onComplete}
          >
            <CheckCircle2 size={16} />
            我已完成惩罚
          </button>
        )}
      {r.mode === "named" ? (
        <div className="ballot-details">
          <h4>
            <Eye size={15} />
            实名投票明细{r.hadRunoff ? " · 加投" : ""}
          </h4>
          {r.ballots.map((b) => (
            <div className="ballot-line" key={b.voterId}>
              <span>{name(b.voterId)}</span>
              <ArrowRight size={13} />
              <strong>{name(b.targetId)}</strong>
              <small>{b.reason}</small>
            </div>
          ))}
          {r.initialBallots.length > 0 && (
            <details className="initial-ballots">
              <summary>查看首轮实名明细</summary>
              {r.initialBallots.map((b) => (
                <div className="ballot-line" key={b.voterId}>
                  <span>{name(b.voterId)}</span>
                  <ArrowRight size={13} />
                  <strong>{name(b.targetId)}</strong>
                  <small>{b.reason}</small>
                </div>
              ))}
            </details>
          )}
        </div>
      ) : (
        <p className="privacy-note">
          <EyeOff size={14} />
          本局为匿名投票，投票关系与理由不公开。
        </p>
      )}
    </div>
  );
}
