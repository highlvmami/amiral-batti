import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessage, type ServerMessage } from "../shared/protocol.js";
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
};

const http = createServer(async (req, res) => {
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
        player = { token: randomBytes(16).toString("hex"), name: msg.name, send, room: null };
        players.set(player.token, player);
      }
      send({ type: "welcome", token: player.token, name: player.name });
      if (player.room) player.room.reconnected(player);
      else send({ type: "room:left" });
      return;
    }
    if (!player) return fail("Önce isim girmelisin.");
    const room = player.room;

    switch (msg.type) {
      case "room:create": {
        room?.leave(player);
        createRoom().join(player);
        return;
      }
      case "room:join": {
        const target = rooms.get(msg.code);
        if (!target) return fail("Bu kodla bir oda bulunamadı.");
        if (target === room) return;
        if (target.isFull) return fail("Oda dolu.");
        room?.leave(player);
        const err = target.join(player);
        if (err) fail(err);
        return;
      }
      case "room:leave": {
        room?.leave(player);
        send({ type: "room:left" });
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
    if (player.room) player.room.disconnected(player);
    else players.delete(player.token);
  });
});

http.listen(PORT, () => {
  console.log(`Amiral Battı sunucusu http://localhost:${PORT} adresinde çalışıyor`);
});
