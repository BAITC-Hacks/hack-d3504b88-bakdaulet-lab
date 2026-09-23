import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

// One supervised child at a time; no shell/npm process between us and Node.
export async function start({
  syncArgs = ["--import", "tsx", "scripts/sync-catalog.ts"],
  serverArgs = ["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"],
} = {}) {
  let child;
  let stopping;
  const stop = signal => {
    stopping ||= signal;
    child?.kill(signal);
  };
  const term = () => stop("SIGTERM");
  const interrupt = () => stop("SIGINT");
  process.on("SIGTERM", term);
  process.on("SIGINT", interrupt);
  const run = args => new Promise(resolve => {
    child = spawn(process.execPath, args, { stdio: "inherit" });
    child.once("error", () => {
      console.error("Unable to launch application process.");
      resolve(1);
    });
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  try {
    console.log("Synchronizing catalog before starting HTTP server...");
    const syncCode = await run(syncArgs);
    if (stopping) return stopping === "SIGINT" ? 130 : 143;
    if (syncCode !== 0) {
      console.error("Catalog synchronization failed; HTTP server was not started.");
      return syncCode;
    }
    console.log("Catalog synchronization finished; starting HTTP server.");
    const serverCode = await run(serverArgs);
    return stopping ? (stopping === "SIGINT" ? 130 : 143) : serverCode;
  } finally {
    process.off("SIGTERM", term);
    process.off("SIGINT", interrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await start();
}
