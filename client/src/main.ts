import "./styles.css";
import type { RoomView, ServerMessage } from "../../shared/protocol.js";
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

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const COLS = "ABCDEFGHIJ";

// ---------- Settings (theme, sound) ----------

const THEMES = [
  { id: "gece", name: "Gece", colors: ["#0b1424", "#3fa7ff"] },
  { id: "deniz", name: "Deniz", colors: ["#04303a", "#ffd166"] },
  { id: "acik", name: "Açık", colors: ["#eef3f9", "#1f6feb"] },
  { id: "gunbatimi", name: "Gün batımı", colors: ["#24132b", "#ff9f43"] },
];

const settings = {
  theme: localStorage.getItem("ab-theme") ?? "gece",
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

const conn = new Connection(onMessage, (on) => $("conn").classList.toggle("on", on));

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
      onRoomState(msg.room);
      break;
    case "error":
      toast(msg.message);
      break;
  }
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

function onRoomState(next: RoomView) {
  const prev = view;
  view = next;
  if (!prev || prev.round !== next.round) {
    resetDraft();
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
  $("finish-tools").hidden = v.phase !== "finished";
  $("enemy-wrap").hidden = v.phase !== "playing" && v.phase !== "finished";
  if (placing) renderShipPicker();

  renderMyBoard(v, placing);
  renderEnemyBoard(v);

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
      if (v.turn === "you") {
        text = "Sıra sende! Rakip sulara ateş et.";
        el.classList.add("yourturn");
      } else text = `${v.opponent?.name ?? "Rakip"} nişan alıyor…`;
      if (v.opponent && !v.opponent.connected) text += " (Rakibin bağlantısı koptu, 60 sn içinde dönmezse kazanırsın.)";
      break;
    case "finished":
      text = v.winner === "you" ? "Kazandın! 🎉" : "Kaybettin. Bir dahaki sefere!";
      el.classList.add(v.winner === "you" ? "win" : "lose");
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
const boardOpts = new WeakMap<HTMLElement, BoardOpts>();

/** Creates the grid once, then only updates cell classes so hovering never replaces elements. */
function buildBoard(el: HTMLElement, classes: CellClass, opts: BoardOpts) {
  boardOpts.set(el, opts);
  el.classList.toggle("clickable", opts.clickable);
  if (!el.childElementCount) {
    const nodes: HTMLElement[] = [document.createElement("span")];
    for (let x = 0; x < BOARD_SIZE; x++) {
      const l = document.createElement("span");
      l.className = "label";
      l.textContent = COLS[x];
      nodes.push(l);
    }
    for (let y = 0; y < BOARD_SIZE; y++) {
      const l = document.createElement("span");
      l.className = "label";
      l.textContent = String(y + 1);
      nodes.push(l);
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
        nodes.push(c);
      }
    }
    el.replaceChildren(...nodes);
    el.onmouseleave = () => boardOpts.get(el)?.onHover?.(null);
  }
  el.querySelectorAll<HTMLElement>(".cell, button[data-x]").forEach((c) => {
    const k = key(Number(c.dataset.x), Number(c.dataset.y));
    c.className = ["cell", ...(classes[k] ?? [])].filter(Boolean).join(" ");
  });
}

function renderMyBoard(v: RoomView, placing: boolean) {
  const classes: CellClass = {};
  const fleet = placing ? draft : (v.myFleet ?? []);
  for (const p of fleet) for (const [x, y] of shipCells(p)) mark(classes, x, y, "ship");
  if (placing) {
    const p = previewPlacement();
    if (p) {
      const ok = validatePartial([...draft.filter((d) => d.type !== p.type), p]);
      for (const [x, y] of shipCells(p)) mark(classes, x, y, "preview", ok ? "" : "bad");
    }
  }
  const hitAtMe = new Set(v.shotsAtMe.filter((s) => s.outcome !== "miss").map((s) => key(s.x, s.y)));
  for (const p of fleet) {
    const cells = shipCells(p);
    if (cells.every(([x, y]) => hitAtMe.has(key(x, y)))) for (const [x, y] of cells) mark(classes, x, y, "sunk");
  }
  v.shotsAtMe.forEach((s, i) =>
    mark(classes, s.x, s.y, "shot", s.outcome === "miss" ? "miss" : "hit", i === v.shotsAtMe.length - 1 ? "last" : ""),
  );
  buildBoard($("my-board"), classes, {
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
  if (v.enemyFleet) for (const p of v.enemyFleet) for (const [x, y] of shipCells(p)) mark(classes, x, y, "reveal");
  for (const p of v.enemySunk) for (const [x, y] of shipCells(p)) mark(classes, x, y, "sunk");
  v.myShots.forEach((s, i) =>
    mark(classes, s.x, s.y, "shot", s.outcome === "miss" ? "miss" : "hit", i === v.myShots.length - 1 ? "last" : ""),
  );
  $("enemy-title").textContent = v.opponent ? `${v.opponent.name} filosu` : "Rakip sular";
  const myTurn = v.phase === "playing" && v.turn === "you";
  buildBoard($("enemy-board"), classes, {
    clickable: myTurn,
    onClick: (x, y) => {
      if (v.myShots.some((s) => s.x === x && s.y === y)) return;
      conn.send({ type: "shot:fire", x, y });
    },
  });
}

$("rematch").onclick = () => conn.send({ type: "rematch:request" });

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
if (myName) conn.hello(myName);
else showScreen("name");
