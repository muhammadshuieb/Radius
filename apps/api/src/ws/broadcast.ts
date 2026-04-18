import type { WebSocketServer } from "ws";

let wss: WebSocketServer | null = null;

export function setWss(server: WebSocketServer) {
  wss = server;
}

export function broadcast(event: string, payload: unknown) {
  if (!wss) return;
  const msg = JSON.stringify({ event, payload, t: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}
