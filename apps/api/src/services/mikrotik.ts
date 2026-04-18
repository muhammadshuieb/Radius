import net from "node:net";
import { config } from "../config.js";

export type MikrotikTestResult = {
  ok: boolean;
  host: string;
  port: number;
  latencyMs?: number;
  error?: string;
  hint?: string;
};

function hintForError(err: NodeJS.ErrnoException | Error): string | undefined {
  const code = "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
  if (code === "ECONNREFUSED") {
    return "Connection refused — check IP, firewall, and that MikroTik API service is enabled (IP Services → api / api-ssl).";
  }
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return "Timed out — verify route to host and that the correct port is open (8728 plain, 8729 SSL).";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "Host could not be resolved — check DNS or use a literal IP.";
  }
  return undefined;
}

export function validateMikrotikPort(port: number, useSsl: boolean): string | undefined {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "Port must be between 1 and 65535.";
  if (useSsl && port !== 8729) return "SSL API typically uses port 8729.";
  if (!useSsl && port !== 8728 && port !== 8729) {
    return "Plain RouterOS API usually uses 8728 (8729 is SSL).";
  }
  return undefined;
}

/** TCP reachability test (does not authenticate to RouterOS). */
export function testMikrotikTcp(host: string, port: number, timeoutMs = config.mikrotikConnectTimeoutMs): Promise<MikrotikTestResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      const latencyMs = Date.now() - started;
      socket.destroy();
      resolve({ ok: true, host, port, latencyMs });
    });
    const onFail = (err: Error) => {
      socket.destroy();
      resolve({
        ok: false,
        host,
        port,
        error: err.message,
        hint: hintForError(err as NodeJS.ErrnoException),
      });
    };
    socket.setTimeout(timeoutMs);
    socket.on("error", onFail);
    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        ok: false,
        host,
        port,
        error: `Socket timeout after ${timeoutMs}ms`,
        hint: hintForError({ name: "Timeout", message: "timeout", code: "ETIMEDOUT" } as NodeJS.ErrnoException),
      });
    });
  });
}

export async function testMikrotikWithRetry(
  host: string,
  port: number,
  retries = 2,
  delayMs = 800
): Promise<MikrotikTestResult & { attempts: number }> {
  let last: MikrotikTestResult = { ok: false, host, port, error: "no attempt" };
  for (let i = 0; i <= retries; i++) {
    last = await testMikrotikTcp(host, port);
    if (last.ok) return { ...last, attempts: i + 1 };
    if (i < retries) await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ...last, attempts: retries + 1 };
}
