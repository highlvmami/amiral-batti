import type { ClientMessage, ServerMessage } from "../../shared/protocol.js";

const TOKEN_KEY = "ab-token";

/** WebSocket wrapper that reconnects automatically and resumes the session with its token. */
export class Connection {
  private ws: WebSocket | null = null;
  private retry = 0;
  private name: string | null = null;

  constructor(
    private readonly onMessage: (msg: ServerMessage) => void,
    private readonly onStatus: (connected: boolean) => void,
  ) {}

  /** Starts (or restarts) the session under this name. */
  hello(name: string): void {
    this.name = name;
    if (this.ws?.readyState === WebSocket.OPEN) this.sendHello();
    else if (!this.ws) this.connect();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus(true);
      this.sendHello();
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      if (msg.type === "welcome") sessionStorage.setItem(TOKEN_KEY, msg.token);
      this.onMessage(msg);
    };
    ws.onclose = () => {
      this.onStatus(false);
      const delay = Math.min(1000 * 2 ** this.retry++, 10_000);
      setTimeout(() => this.connect(), delay);
    };
  }

  private sendHello(): void {
    if (!this.name) return;
    const token = sessionStorage.getItem(TOKEN_KEY) ?? undefined;
    this.send({ type: "hello", name: this.name, token });
  }
}
