import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

const moduleUrl = new URL("./start.mjs", import.meta.url).href;
const args = code => ["-e", code];

function launch(syncCode, serverCode) {
  const program = `import { start } from ${JSON.stringify(moduleUrl)};
    process.exitCode = await start(${JSON.stringify({ syncArgs: args(syncCode), serverArgs: args(serverCode) })});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", program]);
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const done = once(child, "close").then(([code, signal]) => ({ code, signal, output }));
  return { child, done };
}

test("server starts only after successful synchronization", { timeout: 10000 }, async () => {
  const { done } = launch("setTimeout(() => console.log('SYNC_DONE'), 100)", "console.log('SERVER_STARTED')");
  const result = await done;
  assert.equal(result.code, 0);
  assert.ok(result.output.indexOf("SYNC_DONE") < result.output.indexOf("SERVER_STARTED"));
  assert.match(result.output, /SERVER_STARTED/);
});

test("failed synchronization preserves exit code and never starts server", { timeout: 10000 }, async () => {
  const { done } = launch("process.exitCode = 7", "console.log('SERVER_STARTED')");
  const result = await done;
  assert.equal(result.code, 7);
  assert.doesNotMatch(result.output, /SERVER_STARTED/);
  assert.match(result.output, /synchronization failed/);
});

test("server failure is returned without a restart loop", { timeout: 10000 }, async () => {
  const { done } = launch("", "console.log('SERVER_STARTED'); process.exitCode = 9");
  const result = await done;
  assert.equal(result.code, 9);
  assert.equal(result.output.match(/SERVER_STARTED/g)?.length, 1);
});

for (const phase of ["sync", "server"]) {
  test(`SIGTERM reaches ${phase} child and waits for its shutdown`, {
    skip: process.platform === "win32" && "Windows does not deliver POSIX SIGTERM; run this test on Linux.",
    timeout: 10000,
  }, async t => {
    const waiting = "process.on('SIGTERM', () => { console.log('CHILD_STOPPED'); process.exit(0); }); console.log('CHILD_READY'); setInterval(() => {}, 1000)";
    const { child, done } = launch(phase === "sync" ? waiting : "", phase === "server" ? waiting : "console.log('UNEXPECTED_SERVER')");
    t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
    let output = "";
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("CHILD_READY")) {
        output = "";
        child.kill("SIGTERM");
      }
    });
    const result = await done;
    assert.equal(result.code, 143);
    assert.match(result.output, /CHILD_STOPPED/);
    assert.doesNotMatch(result.output, /UNEXPECTED_SERVER/);
  });
}
