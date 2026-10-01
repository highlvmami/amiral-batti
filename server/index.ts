import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessage, type ServerMessage } from "../shared/protocol.js";
import { Invites, lobbyList, type Invite } from "./lobby.js";
import { Room, type Player } from "./room.js";

const PORT = Number(process.env.PORT ?? 3000);
const STATIC_DIR = fileURLToPath(new URL("../dist/client/", import.meta.url));
const MAX_MESSAGES_PER_SECOND = 20;

const players = new Map<string, Player>();
const rooms = new Map<string, Room>();

function newRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    const bytes = randomBytes(6);
    const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    if (!rooms.has(code)) return code;
  }
}

function findById(id: string): Player | undefined {
  for (const p of players.values()) if (p.id === id) return p;
  return undefined;
}

const invites = new Invites((invite) => {
  invite.to.send?.({ type: "lobby:invite-ended", fromId: invite.from.id });
  invite.from.send?.({ type: "lobby:declined", id: invite.to.id, name: invite.to.name, reason: "expired" });
});

/** Cancels every invite involving `player`, telling the other side why. */
function dropInvites(player: Player, reason: "busy" | "offline"): void {
  for (const invite of invites.dropFor(player)) {
    if (invite.from === player) {
      invite.to.send?.({ type: "lobby:invite-ended", fromId: player.id });
    } else {
      invite.from.send?.({ type: "lobby:declined", id: player.id, name: player.name, reason });
      invite.to.send?.({ type: "lobby:invite-ended", fromId: invite.from.id });
    }
  }
}

const lastLobby = new WeakMap<Player, string>();
let lobbyTimer: ReturnType<typeof setTimeout> | null = null;

/** Sends each player in the lobby the current online list, only when it changed. */
function broadcastLobby(): void {
  for (const p of players.values()) {
    if (!p.send) continue;
    if (p.room) {
      lastLobby.delete(p);
      continue;
    }
    const list = lobbyList(players.values(), p);
    const json = JSON.stringify(list);
    if (lastLobby.get(p) === json) continue;
    lastLobby.set(p, json);
    p.send({ type: "lobby:list", players: list });
  }
}

function scheduleLobby(): void {
  lobbyTimer ??= setTimeout(() => {
    lobbyTimer = null;
    broadcastLobby();
  }, 30);
}
// Rooms end on their own (forfeits, timeouts), so also sweep once per second.
setInterval(broadcastLobby, 1000).unref();

function startMatch(a: Player, b: Player): void {
  dropInvites(a, "busy");
  dropInvites(b, "busy");
  a.room?.leave(a);
  b.room?.leave(b);
  const room = createRoom();
  room.join(a);
  room.join(b);
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) out.push(i.address);
  }
  return out;
}

function createRoom(): Room {
  const room = new Room(newRoomCode(), (r) => rooms.delete(r.code));
  rooms.set(room.code, room);
  return room;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const http = createServer(async (req, res) => {
  if (req.url === "/api/info") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        addresses: lanAddresses(),
        port: PORT,
        online: [...players.values()].filter((p) => p.send).length,
        rooms: rooms.size,
      }));
    return;
  }
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const file = join(STATIC_DIR, path === "/" ? "index.html" : path);
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file).catch(() => readFile(join(STATIC_DIR, "index.html")));
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "text/html; charset=utf-8" }).end(body);
  } catch {
    res.writeHead(404).end("İstemci derlenmemiş. Geliştirme için `npm run dev` kullan.");
  }
});

const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 16 * 1024 });

wss.on("connection", (ws: WebSocket) => {
  let player: Player | null = null;
  let windowStart = Date.now();
  let count = 0;
  let alive = true;

  const send = (msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const fail = (message: string) => send({ type: "error", message });

  ws.on("pong", () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15_000);

  ws.on("message", (raw) => {
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      count = 0;
    }
    if (++count > MAX_MESSAGES_PER_SECOND) return fail("Çok hızlı mesaj gönderiyorsun.");

    let data: unknown;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return fail("Geçersiz mesaj.");
    }
    const parsed = ClientMessage.safeParse(data);
    if (!parsed.success) return fail("Geçersiz mesaj.");
    const msg = parsed.data;

    if (msg.type === "hello") {
      const existing = msg.token ? players.get(msg.token) : undefined;
      if (existing) {
        existing.send = send;
        existing.name = existing.room ? existing.name : msg.name;
        player = existing;
      } else {
        player = { id: randomBytes(6).toString("hex"), token: randomBytes(16).toString("hex"), name: msg.name, send, room: null };
        players.set(player.token, player);
      }
      send({ type: "welcome", token: player.token, name: player.name });
      if (player.room) player.room.reconnected(player);
      else send({ type: "room:left" });
      scheduleLobby();
      return;
    }
    if (!player) return fail("Önce isim girmelisin.");
    const room = player.room;

    switch (msg.type) {
      case "room:create": {
        dropInvites(player, "busy");
        room?.leave(player);
        createRoom().join(player);
        scheduleLobby();
        return;
      }
      case "room:join": {
        const target = rooms.get(msg.code);
        if (!target) return fail("Bu kodla bir oda bulunamadı.");
        if (target === room) return;
        if (target.isFull) return fail("Oda dolu.");
        dropInvites(player, "busy");
        room?.leave(player);
        const err = target.join(player);
        if (err) fail(err);
        scheduleLobby();
        return;
      }
      case "room:leave": {
        room?.leave(player);
        send({ type: "room:left" });
        scheduleLobby();
        return;
      }
      case "lobby:challenge": {
        const target = findById(msg.id);
        if (!target || target === player || !target.send || target.room || player.room) {
          return fail("Bu oyuncu şu an müsait değil.");
        }
        if (invites.has(player, target)) return fail("Bu oyuncuya zaten davet gönderdin.");
        invites.add(player, target);
        target.send({ type: "lobby:invite", from: { id: player.id, name: player.name } });
        send({ type: "lobby:sent", id: target.id });
        return;
      }
      case "lobby:cancel": {
        const target = findById(msg.id);
        if (target && invites.take(player, target)) target.send?.({ type: "lobby:invite-ended", fromId: player.id });
        return;
      }
      case "lobby:decline": {
        const from = findById(msg.id);
        if (from && invites.take(from, player)) {
          from.send?.({ type: "lobby:declined", id: player.id, name: player.name, reason: "declined" });
        }
        return;
      }
      case "lobby:accept": {
        const from = findById(msg.id);
        const invite: Invite | undefined = from && invites.take(from, player);
        if (!from || !invite) return fail("Davet artık geçerli değil.");
        if (!from.send || from.room || player.room) {
          send({ type: "lobby:invite-ended", fromId: from.id });
          return fail("Rakip artık müsait değil.");
        }
        startMatch(from, player);
        scheduleLobby();
        return;
      }
      case "fleet:place": {
        const err = room ? room.placeFleet(player, msg.fleet) : "Odada değilsin.";
        if (err) fail(err);
        return;
      }
      case "shot:fire": {
        const err = room ? room.fire(player, msg.x, msg.y) : "Odada değilsin.";
        if (err) fail(err);
        return;
      }
      case "chat:send": {
        room?.chatSend(player, msg.text);
        return;
      }
      case "rematch:request": {
        const err = room ? room.requestRematch(player) : "Odada değilsin.";
        if (err) fail(err);
        return;
      }
    }
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    if (!player || player.send !== send) return;
    player.send = null;
    dropInvites(player, "offline");
    if (player.room) player.room.disconnected(player);
    else players.delete(player.token);
    scheduleLobby();
  });
});

http.listen(PORT, "0.0.0.0", () => {
  console.log(`Amiral Battı sunucusu http://localhost:${PORT} adresinde çalışıyor`);
  for (const ip of lanAddresses()) console.log(`  Aynı ağdaki cihazlar için: http://${ip}:${PORT}`);
});
