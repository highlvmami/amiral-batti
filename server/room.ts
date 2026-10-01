import { Board, shipCells, validateFleet, type Placement } from "../shared/rules.js";
import type { ChatEntry, Phase, RoomView, ServerMessage, ShotView, Side } from "../shared/protocol.js";

export const FORFEIT_MS = 60_000;
const CHAT_LIMIT = 100;

export interface Player {
  /** Public identifier shown to other players; the token stays secret. */
  id: string;
  token: string;
  name: string;
  send: ((msg: ServerMessage) => void) | null;
  room: Room | null;
}

interface Seat {
  player: Player;
  board: Board | null;
  shots: ShotView[];
  score: number;
  wantsRematch: boolean;
  forfeitTimer: ReturnType<typeof setTimeout> | null;
}

type StoredChat = Omit<ChatEntry, "from"> & { from: string | "system" };

export class Room {
  readonly code: string;
  phase: Phase = "waiting";
  round = 0;
  private seats: Seat[] = [];
  private turnIndex = 0;
  private winnerIndex: number | null = null;
  private chat: StoredChat[] = [];

  constructor(
    code: string,
    private readonly onEmpty: (room: Room) => void,
    private readonly forfeitMs = FORFEIT_MS,
  ) {
    this.code = code;
  }

  get isFull(): boolean {
    return this.seats.length === 2;
  }

  has(player: Player): boolean {
    return this.seats.some((s) => s.player === player);
  }

  join(player: Player): string | null {
    if (this.has(player)) return null;
    if (this.isFull) return "Oda dolu.";
    this.seats.push({ player, board: null, shots: [], score: 0, wantsRematch: false, forfeitTimer: null });
    player.room = this;
    this.system(`${player.name} odaya katıldı.`);
    if (this.isFull) this.startRound();
    this.broadcast();
    return null;
  }

  leave(player: Player): void {
    const idx = this.seatIndex(player);
    if (idx < 0) return;
    const seat = this.seats[idx];
    if (seat.forfeitTimer) clearTimeout(seat.forfeitTimer);
    this.seats.splice(idx, 1);
    player.room = null;
    if (this.seats.length === 0) {
      this.onEmpty(this);
      return;
    }
    // A new opponent starts a fresh scoreboard.
    const rest = this.seats[0];
    rest.score = 0;
    rest.board = null;
    rest.shots = [];
    rest.wantsRematch = false;
    this.phase = "waiting";
    this.round = 0;
    this.winnerIndex = null;
    this.system(`${player.name} odadan ayrıldı.`);
    this.broadcast();
  }

  disconnected(player: Player): void {
    const seat = this.seat(player);
    if (!seat) return;
    this.system(`${player.name} bağlantısı koptu.`);
    seat.forfeitTimer = setTimeout(() => {
      seat.forfeitTimer = null;
      if (this.phase === "playing") {
        this.finish(1 - this.seatIndex(player));
        this.system(`${player.name} geri dönmedi, maç ${this.seats[this.winnerIndex!].player.name} adına yazıldı.`);
      }
      this.leave(player);
    }, this.forfeitMs);
    this.broadcast();
  }

  reconnected(player: Player): void {
    const seat = this.seat(player);
    if (!seat) return;
    if (seat.forfeitTimer) {
      clearTimeout(seat.forfeitTimer);
      seat.forfeitTimer = null;
      this.system(`${player.name} geri döndü.`);
    }
    this.broadcast();
  }

  placeFleet(player: Player, fleet: Placement[]): string | null {
    const seat = this.seat(player);
    if (!seat) return "Odada değilsin.";
    if (this.phase !== "placing") return "Şu an gemi yerleştirilemez.";
    if (seat.board) return "Filon zaten hazır.";
    const err = validateFleet(fleet);
    if (err) return err;
    seat.board = new Board(fleet.map((p) => ({ ...p })));
    if (this.seats.every((s) => s.board)) {
      this.phase = "playing";
    }
    this.broadcast();
    return null;
  }

  fire(player: Player, x: number, y: number): string | null {
    const idx = this.seatIndex(player);
    if (idx < 0) return "Odada değilsin.";
    if (this.phase !== "playing") return "Oyun devam etmiyor.";
    if (idx !== this.turnIndex) return "Sıra sende değil.";
    const target = this.seats[1 - idx].board!;
    if (target.hasShot(x, y)) return "Bu kareye zaten ateş ettin.";
    const result = target.receive(x, y);
    this.seats[idx].shots.push({ x, y, outcome: result.outcome });
    if (result.fleetDestroyed) {
      this.finish(idx);
    } else {
      this.turnIndex = 1 - idx;
    }
    this.broadcast();
    return null;
  }

  chatSend(player: Player, text: string): void {
    if (!this.has(player)) return;
    this.pushChat({ from: player.token, name: player.name, text, ts: Date.now() });
    this.broadcast();
  }

  requestRematch(player: Player): string | null {
    const seat = this.seat(player);
    if (!seat) return "Odada değilsin.";
    if (this.phase !== "finished") return "Rövanş yalnızca maç bitince istenebilir.";
    seat.wantsRematch = true;
    if (this.isFull && this.seats.every((s) => s.wantsRematch)) this.startRound();
    this.broadcast();
    return null;
  }

  viewFor(player: Player): RoomView {
    const idx = this.seatIndex(player);
    const me = this.seats[idx];
    const opp = this.seats[1 - idx] as Seat | undefined;
    const side = (i: number | null): Side | null => (i === null ? null : i === idx ? "you" : "opponent");
    const shotsAtMe = opp?.shots ?? [];
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      you: this.playerView(me),
      opponent: opp ? this.playerView(opp) : null,
      turn: this.phase === "playing" ? side(this.turnIndex) : null,
      winner: side(this.winnerIndex),
      myFleet: me.board?.fleet ?? null,
      shotsAtMe,
      myShots: me.shots,
      enemySunk: me.shots.flatMap((s) =>
        s.outcome === "sunk" && opp?.board
          ? opp.board.fleet.filter((p) => isShipAt(p, s.x, s.y))
          : [],
      ),
      enemyFleet: this.phase === "finished" && opp?.board ? opp.board.fleet : null,
      chat: this.chat.map((c) => ({
        ...c,
        from: c.from === "system" ? "system" : c.from === player.token ? "you" : "opponent",
      })),
    };
  }

  private startRound(): void {
    this.round += 1;
    this.phase = "placing";
    this.winnerIndex = null;
    // Players take turns firing first each round.
    this.turnIndex = (this.round - 1) % 2;
    for (const s of this.seats) {
      s.board = null;
      s.shots = [];
      s.wantsRematch = false;
    }
  }

  private finish(winner: number): void {
    this.phase = "finished";
    this.winnerIndex = winner;
    this.seats[winner].score += 1;
  }

  private playerView(s: Seat) {
    return {
      name: s.player.name,
      connected: s.player.send !== null && s.forfeitTimer === null,
      ready: s.board !== null,
      wantsRematch: s.wantsRematch,
      score: s.score,
    };
  }

  private system(text: string): void {
    this.pushChat({ from: "system", name: "Sistem", text, ts: Date.now() });
  }

  private pushChat(entry: StoredChat): void {
    this.chat.push(entry);
    if (this.chat.length > CHAT_LIMIT) this.chat.splice(0, this.chat.length - CHAT_LIMIT);
  }

  private seatIndex(player: Player): number {
    return this.seats.findIndex((s) => s.player === player);
  }

  private seat(player: Player): Seat | undefined {
    return this.seats[this.seatIndex(player)];
  }

  private broadcast(): void {
    for (const s of this.seats) s.player.send?.({ type: "room:state", room: this.viewFor(s.player) });
  }
}

function isShipAt(p: Placement, x: number, y: number): boolean {
  return shipCells(p).some(([cx, cy]) => cx === x && cy === y);
}
