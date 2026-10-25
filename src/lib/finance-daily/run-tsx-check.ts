import { spawn } from "node:child_process";
import { join } from "node:path";
import type { FinanceDailyResult } from "@/lib/finance-daily/types";

function tsxBin(): string {
  return join(process.cwd(), "node_modules", ".bin", "tsx");
}

/**
 * Corre um script/teste via tsx e devolve ok/falha com stdout truncado.
 */
export function runTsxCheck(params: {
  id: number;
  name: string;
  args: string[];
  timeoutMs?: number;
  env?: Record<string, string>;
}): Promise<FinanceDailyResult> {
  const { id, name, args, timeoutMs = 180_000, env } = params;

  return new Promise((resolve) => {
    const child = spawn(tsxBin(), args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        id,
        name,
        ok: false,
        skipped: false,
        detail: `Timeout após ${Math.round(timeoutMs / 1000)}s`,
      });
    }, timeoutMs);

    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        id,
        name,
        ok: false,
        skipped: false,
        detail: `Falha ao iniciar tsx: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const tail = (stdout + "\n" + stderr).trim().split("\n").slice(-8).join(" | ");
      if (code === 0) {
        resolve({
          id,
          name,
          ok: true,
          skipped: false,
          detail: tail || "OK",
        });
        return;
      }
      resolve({
        id,
        name,
        ok: false,
        skipped: false,
        detail: `exit=${code} ${tail.slice(0, 500)}`,
      });
    });
  });
}
