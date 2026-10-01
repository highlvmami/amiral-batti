import { z } from "zod";
import { BOARD_SIZE, type Placement, type ShotOutcome } from "./rules.js";

const coord = z.number().int().min(0).max(BOARD_SIZE - 1);

const placement = z.object({
  type: z.enum(["carrier", "battleship", "submarine", "patrol"]),
  x: coord,
  y: coord,
  dir: z.enum(["h", "v"]),
});

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), name: z.string().trim().min(1).max(20), token: z.string().max(64).optional() }),
  z.object({ type: z.literal("room:create") }),
  z.object({ type: z.literal("room:join"), code: z.string().trim().toUpperCase().length(6) }),
  z.object({ type: z.literal("room:leave") }),
  z.object({ type: z.literal("fleet:place"), fleet: z.array(placement).max(10) }),
  z.object({ type: z.literal("shot:fire"), x: coord, y: coord }),
  z.object({ type: z.literal("chat:send"), text: z.string().trim().min(1).max(300) }),
  z.object({ type: z.literal("rematch:request") }),
  z.object({ type: z.literal("lobby:challenge"), id: z.string().max(32) }),
  z.object({ type: z.literal("lobby:cancel"), id: z.string().max(32) }),
  z.object({ type: z.literal("lobby:accept"), id: z.string().max(32) }),
  z.object({ type: z.literal("lobby:decline"), id: z.string().max(32) }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export type Phase = "waiting" | "placing" | "playing" | "finished";
export type Side = "you" | "opponent";

export interface ShotView {
  x: number;
  y: number;
  outcome: ShotOutcome;
}

export interface ChatEntry {
  from: Side | "system";
  name: string;
  text: string;
  ts: number;
}

export interface PlayerView {
  name: string;
  connected: boolean;
  ready: boolean;
  wantsRematch: boolean;
  score: number;
}

/** Everything one player is allowed to see. Opponent ships stay hidden until the game ends. */
export interface RoomView {
  code: string;
  phase: Phase;
  round: number;
  you: PlayerView;
  opponent: PlayerView | null;
  turn: Side | null;
  winner: Side | null;
  myFleet: Placement[] | null;
  shotsAtMe: ShotView[];
  myShots: ShotView[];
  enemySunk: Placement[];
  enemyFleet: Placement[] | null;
  chat: ChatEntry[];
}

export interface LobbyPlayer {
  id: string;
  name: string;
  busy: boolean;
}

export type DeclineReason = "declined" | "expired" | "busy" | "offline";

export type ServerMessage =
  | { type: "welcome"; token: string; name: string }
  | { type: "room:state"; room: RoomView }
  | { type: "room:left" }
  | { type: "lobby:list"; players: LobbyPlayer[] }
  | { type: "lobby:invite"; from: { id: string; name: string } }
  | { type: "lobby:invite-ended"; fromId: string }
  | { type: "lobby:sent"; id: string }
  | { type: "lobby:declined"; id: string; name: string; reason: DeclineReason }
  | { type: "error"; message: string };
