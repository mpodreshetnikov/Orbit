#!/usr/bin/env node

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function dockerEngineReachable() {
  const result = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    stdio: "ignore",
    windowsHide: true,
    timeout: 10000,
  });
  return result.status === 0;
}

function dockerContainerApiReachable() {
  const result = spawnSync("docker", ["ps", "--format", "{{.ID}}"], {
    stdio: "ignore",
    windowsHide: true,
    timeout: 10000,
  });
  return result.status === 0;
}

function dockerFullyReachable() {
  return dockerEngineReachable() && dockerContainerApiReachable();
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function findDockerDesktopExecutable() {
  const candidates = [
    path.join(process.env.ProgramFiles || "", "Docker", "Docker", "Docker Desktop.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Docker", "Docker", "Docker Desktop.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Docker", "Docker Desktop.exe"),
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function startDockerDesktop(executablePath) {
  try {
    const child = spawn(executablePath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts the daemon on Linux, where nothing else will.
 *
 * On a developer's machine the daemon already runs under systemd, which is why this file used
 * to treat anything but Windows as ready. In an agent container it does not: the binary is
 * installed and the socket is absent, so `docker info` fails with the same message a machine
 * without Docker at all would give. Reading that as "no Docker here" cost T-0013 every database
 * check it had — six migrations, four database functions and five pgTAP files were written and
 * pushed without ever being executed, and the first CI run of that SQL found four defects.
 *
 * The default arguments disable iptables and ip6tables because the agent kernel boots with
 * `ipv6.disable=1`, which fails ip6tables setup outright; published ports still work through
 * the userland proxy. `DOCKERD_ARGS` overrides them where the host is less constrained.
 */
function startDockerDaemonOnLinux(out, waitMs, pollMs) {
  const dockerdPath = ["/usr/bin/dockerd", "/usr/local/bin/dockerd"].find((candidate) =>
    fs.existsSync(candidate),
  );
  if (!dockerdPath) {
    out.error("Docker is not reachable and no dockerd binary is installed.");
    return 1;
  }

  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    out.error(
      "Docker is not reachable and this process is not root, so the daemon cannot be started " +
        "from here. Start it with `sudo dockerd` or through your service manager.",
    );
    return 1;
  }

  const args = process.env.DOCKERD_ARGS
    ? process.env.DOCKERD_ARGS.split(/\s+/).filter(Boolean)
    : ["--iptables=false", "--ip6tables=false"];

  out.log("Docker engine is not reachable. Starting dockerd...");

  // The binary that was found, not whatever `dockerd` resolves to on PATH — the check above
  // proves one of the two absolute paths exists and proves nothing about PATH.
  //
  // `spawn` reports ENOENT and EACCES on the child's `error` event, after this block has already
  // returned, so the `catch` never sees them. Without a listener that event is unhandled and
  // takes the process down; with one, the failure is a diagnostic instead of the polling loop
  // running its full two minutes and then blaming a timeout.
  let spawnError = null;
  try {
    const child = spawn(dockerdPath, args, { detached: true, stdio: "ignore" });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.unref();
  } catch (error) {
    out.error(`Failed to launch dockerd: ${error.message}`);
    return 1;
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    sleep(pollMs);
    if (spawnError) {
      out.error(`Failed to launch ${dockerdPath}: ${spawnError.message}`);
      return 1;
    }
    if (dockerFullyReachable()) {
      out.log("Docker daemon is ready.");
      return 0;
    }
  }

  out.error(`dockerd did not become ready within ${Math.round(waitMs / 1000)}s.`);
  return 1;
}

function ensureDockerReady(options = {}) {
  const waitMs = options.waitMs ?? 120000;
  const pollMs = options.pollMs ?? 2000;
  const stableWaitMs = options.stableWaitMs ?? 15000;
  const out = options.out ?? console;

  if (process.env.SKIP_DOCKER_PREFLIGHT === "1") {
    return 0;
  }

  if (process.platform === "linux") {
    return dockerFullyReachable() ? 0 : startDockerDaemonOnLinux(out, waitMs, pollMs);
  }

  if (process.platform !== "win32") {
    return 0;
  }

  if (dockerFullyReachable()) {
    return 0;
  }

  out.log("Docker engine is not reachable. Starting Docker Desktop...");
  const executablePath = findDockerDesktopExecutable();

  if (!executablePath) {
    out.error(
      "Docker Desktop executable was not found. Install Docker Desktop: https://docs.docker.com/desktop",
    );
    return 1;
  }

  if (!startDockerDesktop(executablePath)) {
    out.error(`Failed to launch Docker Desktop at: ${executablePath}`);
    return 1;
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    sleep(pollMs);
    if (dockerFullyReachable()) {
      const stabilizeDeadline = Date.now() + stableWaitMs;
      while (Date.now() < stabilizeDeadline) {
        sleep(pollMs);
        if (!dockerFullyReachable()) {
          break;
        }
      }

      if (dockerFullyReachable()) {
        out.log("Docker Desktop is ready.");
        return 0;
      }
    }
  }

  out.error(
    `Docker Desktop did not become ready within ${Math.round(waitMs / 1000)}s (including ${Math.round(stableWaitMs / 1000)}s stability wait).`,
  );
  return 1;
}

module.exports = { ensureDockerReady };
