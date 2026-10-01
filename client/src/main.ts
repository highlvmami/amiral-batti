import "@fontsource-variable/bricolage-grotesque";
import "./styles.css";
import type { LobbyPlayer, RoomView, ServerMessage } from "../../shared/protocol.js";
import {
  BOARD_SIZE,
  FLEET,
  randomFleet,
  shipCells,
  validatePartial,
  type Orientation,
  type Placement,
  type ShipType,
} from "../../shared/rules.js";
import { Connection } from "./net.js";
import { flagElement, flagLetters } from "./flags.js";
import { shipDrawing, shipElement, type ShipState } from "./ships.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const COLS = "ABCDEFGHIJ";

// ---------- Settings (theme, sound) ----------

const THEMES = [
  { id: "sis", name: "Sis", colors: ["#E9F0EE", "#0E7C86"] },
  { id: "deniz", name: "Deniz", colors: ["#0B2F38", "#F2B632"] },
  { id: "gece", name: "Gece", colors: ["#0F1B2D", "#4DA3FF"] },
];

const settings = {
  theme: THEMES.some((t) => t.id === localStorage.getItem("ab-theme")) ? localStorage.getItem("ab-theme")! : "sis",
  sound: localStorage.getItem("ab-sound") !== "off",
};

function applyTheme(id: string) {
  settings.theme = id;
  localStorage.setItem("ab-theme", id);
  document.documentElement.dataset.theme = id;
  renderThemes();
}

function renderThemes() {
  const box = $("themes");
  box.replaceChildren(
    ...THEMES.map((t) => {
      const b = document.createElement("button");
      b.className = t.id === settings.theme ? "selected" : "";
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = `linear-gradient(90deg, ${t.colors[0]} 50%, ${t.colors[1]} 50%)`;
      b.append(sw, t.name);
      b.onclick = () => applyTheme(t.id);
      return b;
    }),
  );
}

const soundBox = $<HTMLInputElement>("sound");
soundBox.checked = settings.sound;
soundBox.onchange = () => {
  settings.sound = soundBox.checked;
  localStorage.setItem("ab-sound", settings.sound ? "on" : "off");
};

let audio: AudioContext | null = null;
function beep(kind: "miss" | "hit" | "sunk") {
  if (!settings.sound) return;
  audio ??= new AudioContext();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = kind === "miss" ? "sine" : "square";
  osc.frequency.value = kind === "miss" ? 300 : kind === "hit" ? 160 : 90;
  gain.gain.setValueAtTime(0.15, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + (kind === "sunk" ? 0.6 : 0.25));
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.6);
}

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("tab-game").hidden = tab.dataset.tab !== "game";
    $("tab-settings").hidden = tab.dataset.tab !== "settings";
  };
});

// ---------- Connection ----------

let view: RoomView | null = null;
let myName = localStorage.getItem("ab-name") ?? "";
const inviteCode = new URLSearchParams(location.search).get("oda")?.toUpperCase() ?? null;

let everConnected = false;
const conn = new Connection(onMessage, (on) => {
  everConnected ||= on;
  $("conn").classList.toggle("on", on);
  $("conn").classList.toggle("lost", !on && everConnected);
  if (!on) {
    online = [];
    incoming = [];
    pending.clear();
    renderLobby();
  }
});

function onMessage(msg: ServerMessage) {
  switch (msg.type) {
    case "welcome":
      myName = msg.name;
      $("lobby-name").textContent = myName;
      break;
    case "room:left":
      view = null;
      resetDraft();
      showScreen("lobby");
      if (inviteCode && !sessionStorage.getItem("ab-invite-used")) {
        sessionStorage.setItem("ab-invite-used", "1");
        conn.send({ type: "room:join", code: inviteCode });
      }
      break;
    case "room:state":
      incoming = [];
      pending.clear();
      onRoomState(msg.room);
      break;
    case "lobby:list":
      online = msg.players;
      // A pending invite only makes sense while its target is still in the lobby.
      for (const id of pending) if (!online.some((p) => p.id === id && !p.busy)) pending.delete(id);
      renderLobby();
      break;
    case "lobby:invite":
      incoming = [...incoming.filter((i) => i.id !== msg.from.id), msg.from];
      renderLobby();
      break;
    case "lobby:invite-ended":
      incoming = incoming.filter((i) => i.id !== msg.fromId);
      renderLobby();
      break;
    case "lobby:sent":
      pending.add(msg.id);
      renderLobby();
      break;
    case "lobby:declined":
      pending.delete(msg.id);
      toast(
        {
          declined: `${msg.name} davetini reddetti.`,
          expired: `${msg.name} davete cevap vermedi.`,
          busy: `${msg.name} başka bir maça geçti.`,
          offline: `${msg.name} çevrimdışı oldu.`,
        }[msg.reason],
      );
      renderLobby();
      break;
    case "error":
      toast(msg.message);
      break;
  }
}

// ---------- LAN lobby ----------

let online: LobbyPlayer[] = [];
let incoming: { id: string; name: string }[] = [];
const pending = new Set<string>();

function renderLobby() {
  const free = online.filter((p) => !p.busy).length;
  $("online-count").textContent = online.length ? `${free} müsait / ${online.length}` : "";
  $("online-empty").hidden = online.length > 0;

  $("invites").replaceChildren(
    ...incoming.map((i) => {
      const li = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = `${i.name} seni maça davet ediyor`;
      const accept = document.createElement("button");
      accept.className = "primary small";
      accept.textContent = "Kabul";
      accept.onclick = () => conn.send({ type: "lobby:accept", id: i.id });
      const decline = document.createElement("button");
      decline.className = "small";
      decline.textContent = "Reddet";
      decline.onclick = () => {
        conn.send({ type: "lobby:decline", id: i.id });
        incoming = incoming.filter((x) => x.id !== i.id);
        renderLobby();
      };
      li.append(text, accept, decline);
      return li;
    }),
  );

  $("online-list").replaceChildren(
    ...online.map((p) => {
      const li = document.createElement("li");
      const dot = document.createElement("i");
      dot.className = p.busy ? "dot busy" : "dot";
      const name = document.createElement("span");
      name.className = "pname";
      name.textContent = p.name;
      const state = document.createElement("span");
      state.className = "pstate";
      state.textContent = p.busy ? "Maçta" : "Müsait";
      const btn = document.createElement("button");
      btn.className = "small";
      if (pending.has(p.id)) {
        btn.textContent = "İptal";
        btn.onclick = () => {
          conn.send({ type: "lobby:cancel", id: p.id });
          pending.delete(p.id);
          renderLobby();
        };
        state.textContent = "Cevap bekleniyor…";
      } else {
        btn.textContent = "Meydan oku";
        btn.disabled = p.busy;
        btn.onclick = () => conn.send({ type: "lobby:challenge", id: p.id });
      }
      li.append(dot, name, state, btn);
      return li;
    }),
  );
}

interface ServerInfo {
  addresses: string[];
  online: number;
  rooms: number;
}

async function refreshInfo() {
  const dot = $("live-dot");
  const text = $("live-text");
  try {
    const info = (await (await fetch("/api/info")).json()) as ServerInfo;
    dot.classList.remove("off");
    text.textContent = info.online
      ? `${info.online} kaptan çevrimiçi, ${info.rooms} açık oda.`
      : "Şu an lobide kimse yok. İlk sen gir.";
    if (info.addresses.length) {
      // In dev the page itself is served on another port than the game server.
      const port = location.port ? `:${location.port}` : "";
      $("lan-links").replaceChildren(
        ...info.addresses.map((ip) => {
          const code = document.createElement("code");
          code.textContent = `http://${ip}${port}`;
          return code;
        }),
      );
      $("lan-box").hidden = false;
    }
  } catch {
    dot.classList.add("off");
    text.textContent = "Sunucuya ulaşılamıyor.";
  }
}

// ---------- Entry screen: signal flags and fleet roster ----------

const flagRow = $("flag-row");
let shownFlags: string[] = [];

function renderFlags(name: string) {
  const letters = flagLetters(name);
  const ghost = letters.length === 0;
  const target = ghost ? flagLetters("Amiral") : letters;
  flagRow.classList.toggle("ghost", ghost);
  let keep = 0;
  while (keep < shownFlags.length && keep < target.length && shownFlags[keep] === target[keep]) keep++;
  while (flagRow.children.length > keep) flagRow.lastElementChild!.remove();
  for (const letter of target.slice(keep)) {
    const el = flagElement(letter);
    if (!ghost) el.classList.add("hoist");
    flagRow.append(el);
  }
  shownFlags = target;
}

function renderRoster() {
  $("fleet-roster").replaceChildren(
    ...FLEET.map((s) => {
      const li = document.createElement("li");
      const strip = document.createElement("span");
      strip.className = "strip";
      strip.style.setProperty("--len", String(s.length));
      strip.append(shipDrawing(s.type));
      const name = document.createElement("span");
      name.className = "rname";
      name.textContent = s.name;
      const len = document.createElement("span");
      len.className = "rlen";
      len.textContent = `${s.length} kare`;
      li.append(strip, name, len);
      return li;
    }),
  );
}

function showScreen(name: "name" | "lobby" | "room") {
  $("screen-name").hidden = name !== "name";
  $("screen-lobby").hidden = name !== "lobby";
  $("screen-room").hidden = name !== "room";
}

let toastTimer = 0;
function toast(text: string) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2500);
}

// ---------- Name & lobby ----------

$<HTMLInputElement>("name-input").value = myName;
$("name-form").onsubmit = (e) => {
  e.preventDefault();
  myName = $<HTMLInputElement>("name-input").value.trim();
  if (!myName) return;
  localStorage.setItem("ab-name", myName);
  conn.hello(myName);
};
$("change-name").onclick = () => showScreen("name");
$("create-room").onclick = () => conn.send({ type: "room:create" });
$("join-form").onsubmit = (e) => {
  e.preventDefault();
  const code = $<HTMLInputElement>("join-code").value.trim().toUpperCase();
  if (code.length === 6) conn.send({ type: "room:join", code });
  else toast("Oda kodu 6 karakter olmalı.");
};
$("leave-room").onclick = () => conn.send({ type: "room:leave" });
$("copy-link").onclick = async () => {
  if (!view) return;
  const url = `${location.origin}${location.pathname}?oda=${view.code}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Davet linki kopyalandı.");
  } catch {
    prompt("Davet linki:", url);
  }
};

// ---------- Placement draft ----------

let draft: Placement[] = [];
let selected: ShipType | null = FLEET[0].type;
let dir: Orientation = "h";
let hover: [number, number] | null = null;

function resetDraft() {
  draft = [];
  selected = FLEET[0].type;
}

function nextUnplaced(): ShipType | null {
  return FLEET.find((s) => !draft.some((p) => p.type === s.type))?.type ?? null;
}

function previewPlacement(): Placement | null {
  if (!selected || !hover) return null;
  return { type: selected, x: hover[0], y: hover[1], dir };
}

function placeAt(x: number, y: number) {
  const existing = draft.find((p) => shipCells(p).some(([cx, cy]) => cx === x && cy === y));
  if (!selected && existing) {
    // Pick an already placed ship back up to move it.
    draft = draft.filter((p) => p !== existing);
    selected = existing.type;
    dir = existing.dir;
    renderRoom();
    return;
  }
  const p = previewPlacement();
  if (!p) return;
  const others = draft.filter((d) => d.type !== p.type);
  if (!validatePartial([...others, p])) return toast("Gemi oraya sığmıyor.");
  draft = [...others, p];
  selected = nextUnplaced();
  renderRoom();
}

$("rotate").onclick = () => {
  dir = dir === "h" ? "v" : "h";
  renderRoom();
};
$("random").onclick = () => {
  draft = randomFleet();
  selected = null;
  renderRoom();
};
$("clear").onclick = () => {
  resetDraft();
  renderRoom();
};
$("ready").onclick = () => {
  if (draft.length !== FLEET.length) return toast("Önce tüm gemileri yerleştir.");
  conn.send({ type: "fleet:place", fleet: draft });
};
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "r" && view?.phase === "placing" && document.activeElement?.tagName !== "INPUT") {
    $("rotate").click();
  }
});

// ---------- Room rendering ----------

let lastShotCount = { mine: 0, theirs: 0 };
/** The player closed the end-of-match card to look at the revealed enemy fleet. */
let resultHidden = false;

function onRoomState(next: RoomView) {
  const prev = view;
  view = next;
  if (!prev || prev.round !== next.round) {
    resetDraft();
    resultHidden = false;
    lastShotCount = { mine: next.myShots.length, theirs: next.shotsAtMe.length };
  }
  // Play a sound for any new shot.
  const newShot =
    next.myShots.length > lastShotCount.mine
      ? next.myShots.at(-1)
      : next.shotsAtMe.length > lastShotCount.theirs
        ? next.shotsAtMe.at(-1)
        : undefined;
  if (newShot) beep(newShot.outcome);
  lastShotCount = { mine: next.myShots.length, theirs: next.shotsAtMe.length };

  showScreen("room");
  renderRoom();
  renderChat(prev);
}

function renderRoom() {
  if (!view) return;
  const v = view;
  $("room-code").textContent = v.code;
  renderScoreboard(v);
  renderBanner(v);

  const placing = v.phase === "placing" && !v.you.ready;
  $("placing-tools").hidden = !placing;
  $("enemy-wrap").hidden = v.phase !== "playing" && v.phase !== "finished";
  if (placing) renderShipPicker();

  renderMyBoard(v, placing);
  renderEnemyBoard(v);
  renderBoardStatus(v);

  if (v.phase === "finished") {
    const btn = $<HTMLButtonElement>("rematch");
    btn.disabled = v.you.wantsRematch || !v.opponent;
    $("rematch-status").textContent = !v.opponent
      ? "Rakip odadan ayrıldı."
      : v.you.wantsRematch
        ? "Rakibin cevabı bekleniyor…"
        : v.opponent.wantsRematch
          ? `${v.opponent.name} rövanş istiyor!`
          : "";
  }
}

function renderScoreboard(v: RoomView) {
  const box = $("scoreboard");
  const side = (p: RoomView["you"] | null, fallback: string) => {
    const span = document.createElement("span");
    if (p) {
      const dot = document.createElement("i");
      dot.className = p.connected ? "dot" : "dot off";
      span.append(dot, p.name);
    } else span.textContent = fallback;
    return span;
  };
  const score = document.createElement("span");
  score.className = "score";
  score.textContent = `${v.you.score} - ${v.opponent?.score ?? 0}`;
  const round = document.createElement("span");
  round.className = "round";
  round.textContent = v.round ? `Tur ${v.round}` : "";
  box.replaceChildren(side(v.you, ""), score, side(v.opponent, "Rakip bekleniyor"), round);
}

function renderBanner(v: RoomView) {
  const el = $("banner");
  el.className = "banner";
  let text = "";
  switch (v.phase) {
    case "waiting":
      text = `Rakip bekleniyor. Oda kodunu (${v.code}) veya davet linkini paylaş.`;
      break;
    case "placing":
      text = v.you.ready
        ? `${v.opponent?.name ?? "Rakip"} filosunu yerleştiriyor…`
        : "Gemilerini yerleştir: bir gemi seç, tahtaya tıkla. Yerleşmiş gemiye tıklayarak taşıyabilirsin.";
      break;
    case "playing":
      // Turn and result live on the enemy board itself (renderBoardStatus).
      if (v.opponent && !v.opponent.connected) text = "Rakibin bağlantısı koptu, 60 sn içinde dönmezse kazanırsın.";
      break;
  }
  el.textContent = text;
}

function renderShipPicker() {
  $("ship-picker").replaceChildren(
    ...FLEET.map((s) => {
      const b = document.createElement("button");
      const placed = draft.some((p) => p.type === s.type);
      b.className = [placed ? "placed" : "", selected === s.type ? "selected" : ""].join(" ");
      const bar = document.createElement("span");
      bar.className = "bar";
      for (let i = 0; i < s.length; i++) bar.append(document.createElement("i"));
      b.append(bar, s.name);
      b.onclick = () => {
        selected = s.type;
        draft = draft.filter((p) => p.type !== s.type);
        renderRoom();
      };
      return b;
    }),
  );
  $<HTMLButtonElement>("ready").disabled = draft.length !== FLEET.length;
  $("rotate").textContent = `Döndür (R) · ${dir === "h" ? "Yatay" : "Dikey"}`;
}

type CellClass = Record<string, string[]>;
const key = (x: number, y: number) => `${x},${y}`;
function mark(map: CellClass, x: number, y: number, ...cls: string[]) {
  (map[key(x, y)] ??= []).push(...cls);
}

interface BoardOpts {
  clickable: boolean;
  onClick?: (x: number, y: number) => void;
  onHover?: (c: [number, number] | null) => void;
}
interface DrawnShip {
  p: Placement;
  state: ShipState;
}
const boardOpts = new WeakMap<HTMLElement, BoardOpts>();

function labels(cls: string, texts: string[]): HTMLElement {
  const box = document.createElement("div");
  box.className = cls;
  box.replaceChildren(
    ...texts.map((t) => {
      const l = document.createElement("span");
      l.textContent = t;
      return l;
    }),
  );
  return box;
}

/** Builds the sea once; later renders only update cell classes and the ship layer, so hovering never replaces cells. */
function buildBoard(el: HTMLElement, classes: CellClass, ships: DrawnShip[], opts: BoardOpts) {
  boardOpts.set(el, opts);
  el.classList.toggle("clickable", opts.clickable);
  if (!el.childElementCount) {
    const sea = document.createElement("div");
    sea.className = "sea";
    const shipLayer = document.createElement("div");
    shipLayer.className = "ship-layer";
    const grid = document.createElement("div");
    grid.className = "grid";
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        const c = document.createElement("button");
        c.title = `${COLS[x]}${y + 1}`;
        c.dataset.x = String(x);
        c.dataset.y = String(y);
        c.onclick = () => {
          const o = boardOpts.get(el);
          if (o?.clickable) o.onClick?.(x, y);
        };
        c.onmouseenter = () => boardOpts.get(el)?.onHover?.([x, y]);
        grid.append(c);
      }
    }
    grid.onmouseleave = () => boardOpts.get(el)?.onHover?.(null);
    sea.append(shipLayer, grid);
    el.append(
      document.createElement("span"),
      labels("cols", COLS.split("")),
      labels("rows", Array.from({ length: BOARD_SIZE }, (_, i) => String(i + 1))),
      sea,
    );
  }
  el.querySelectorAll<HTMLElement>(".grid > button").forEach((c) => {
    c.className = ["cell", ...(classes[key(Number(c.dataset.x), Number(c.dataset.y))] ?? [])].filter(Boolean).join(" ");
  });
  el.querySelector(".ship-layer")!.replaceChildren(...ships.map((d) => shipElement(d.p, d.state)));
}

function isSunk(p: Placement, hits: Set<string>): boolean {
  return shipCells(p).every(([x, y]) => hits.has(key(x, y)));
}

function shotMarks(classes: CellClass, shots: RoomView["myShots"]) {
  shots.forEach((s, i) =>
    mark(classes, s.x, s.y, "shot", s.outcome === "miss" ? "miss" : "hit", i === shots.length - 1 ? "last" : ""),
  );
}

function renderMyBoard(v: RoomView, placing: boolean) {
  const classes: CellClass = {};
  const fleet = placing ? draft : (v.myFleet ?? []);
  const hits = new Set(v.shotsAtMe.filter((s) => s.outcome !== "miss").map((s) => key(s.x, s.y)));
  const ships: DrawnShip[] = fleet.map((p) => ({ p, state: isSunk(p, hits) ? "sunk" : "normal" }));
  if (placing) {
    const p = previewPlacement();
    if (p) {
      const ok = validatePartial([...draft.filter((d) => d.type !== p.type), p]);
      ships.push({ p, state: ok ? "preview" : "bad" });
    }
  }
  for (const d of ships) if (d.state === "sunk") for (const [x, y] of shipCells(d.p)) mark(classes, x, y, "sunk");
  shotMarks(classes, v.shotsAtMe);
  buildBoard($("my-board"), classes, ships, {
    clickable: placing,
    onClick: placeAt,
    onHover: placing
      ? (c) => {
          hover = c;
          renderMyBoard(v, true);
        }
      : undefined,
  });
}

function renderEnemyBoard(v: RoomView) {
  if (v.phase !== "playing" && v.phase !== "finished") return;
  const classes: CellClass = {};
  const sunkTypes = new Set(v.enemySunk.map((p) => p.type));
  const visible = v.enemyFleet ?? v.enemySunk;
  const ships: DrawnShip[] = visible.map((p) => ({ p, state: sunkTypes.has(p.type) ? "sunk" : "normal" }));
  for (const p of v.enemySunk) for (const [x, y] of shipCells(p)) mark(classes, x, y, "sunk");
  shotMarks(classes, v.myShots);
  $("enemy-title").textContent = v.opponent ? `${v.opponent.name} filosu` : "Rakip sular";
  const myTurn = v.phase === "playing" && v.turn === "you";
  buildBoard($("enemy-board"), classes, ships, {
    clickable: myTurn,
    onClick: (x, y) => {
      if (v.myShots.some((s) => s.x === x && s.y === y)) return;
      conn.send({ type: "shot:fire", x, y });
    },
  });
}

/** Turn badge, "opponent is aiming" veil and the end-of-match card, drawn over the enemy board. */
function renderBoardStatus(v: RoomView) {
  const playing = v.phase === "playing";
  const finished = v.phase === "finished";
  const myTurn = playing && v.turn === "you";
  const won = v.winner === "you";

  $("enemy-wrap").classList.toggle("yourturn", myTurn);
  const pill = $("turn-pill");
  pill.hidden = !myTurn;
  pill.textContent = "Sıra sende! Ateş et";

  const veil = $("board-veil");
  veil.hidden = !((playing && !myTurn) || (finished && !resultHidden));
  veil.className = finished ? `board-veil ${won ? "win" : "lose"}` : "board-veil";
  $("veil-wait").hidden = !playing;
  $("veil-wait-text").textContent = `${v.opponent?.name ?? "Rakip"} nişan alıyor…`;

  $("finish-tools").hidden = !finished;
  $("show-result").hidden = !(finished && resultHidden);
  if (finished) {
    $("result-title").textContent = won ? "Kazandın! 🎉" : "Kaybettin";
    $("result-score").textContent = `Skor ${v.you.score} - ${v.opponent?.score ?? 0}`;
  }
}

$("rematch").onclick = () => conn.send({ type: "rematch:request" });
$("show-board").onclick = () => {
  resultHidden = true;
  renderRoom();
};
$("show-result").onclick = () => {
  resultHidden = false;
  renderRoom();
};

// ---------- Chat ----------

function renderChat(prev: RoomView | null) {
  if (!view) return;
  const log = $("chat-log");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  if (prev && prev.chat.length === view.chat.length && prev.chat.at(-1)?.ts === view.chat.at(-1)?.ts) return;
  log.replaceChildren(
    ...view.chat.map((m) => {
      const li = document.createElement("li");
      li.className = m.from;
      if (m.from === "opponent") {
        const b = document.createElement("b");
        b.textContent = m.name;
        li.append(b);
      }
      li.append(m.text);
      return li;
    }),
  );
  if (atBottom || !prev) log.scrollTop = log.scrollHeight;
}

$("chat-form").onsubmit = (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("chat-input");
  const text = input.value.trim();
  if (!text) return;
  conn.send({ type: "chat:send", text });
  input.value = "";
};

// ---------- Boot ----------

applyTheme(settings.theme);
renderRoster();
renderFlags($<HTMLInputElement>("name-input").value);
$("name-input").addEventListener("input", (e) => renderFlags((e.target as HTMLInputElement).value));
void refreshInfo();
setInterval(() => void refreshInfo(), 5000);
renderLobby();
if (myName) conn.hello(myName);
else showScreen("name");
