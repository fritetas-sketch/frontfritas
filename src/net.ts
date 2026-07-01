import type { C2S, S2C } from "./protocol.ts";

export interface NetHandlers {
  onLobby: (m: Extract<S2C, { t: "lobby" }>) => void;
  onStart: (m: Extract<S2C, { t: "start" }>) => void;
  onState: (m: Extract<S2C, { t: "state" }>) => void;
  onError: (msg: string) => void;
  onClose: () => void;
}

/** Resolve the WebSocket URL: explicit env override, dev fallback, else same
 *  origin (the server can serve both static files and the socket). */
export function defaultWsUrl(): string {
  const env = (import.meta as any).env?.VITE_WS_URL as string | undefined;
  if (env) return env;
  const loc = window.location;
  // Vite dev server (5173) has no WebSocket — point at the standalone server.
  if (loc.port === "5173") return "ws://localhost:8787";
  // Otherwise the game server serves this page: use the same origin.
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}`;
}

export class Net {
  private ws?: WebSocket;

  constructor(private url: string, private h: Partial<NetHandlers>) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws.onopen = () => {
        settled = true;
        resolve();
      };
      this.ws.onerror = () => {
        if (!settled) reject(new Error("Connexion au serveur impossible."));
      };
      this.ws.onclose = () => this.h.onClose?.();
      this.ws.onmessage = (ev) => this.dispatch(ev.data);
    });
  }

  private dispatch(raw: string) {
    let msg: S2C;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.t) {
      case "lobby": this.h.onLobby?.(msg); break;
      case "start": this.h.onStart?.(msg); break;
      case "state": this.h.onState?.(msg); break;
      case "error": this.h.onError?.(msg.msg); break;
    }
  }

  send(msg: C2S) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close() {
    this.ws?.close();
    this.ws = undefined;
  }
}
