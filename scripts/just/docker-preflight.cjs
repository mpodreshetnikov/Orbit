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
    path.join(
      process.env.ProgramFiles || "",
      "Docker",
      "Docker",
      "Docker Desktop.exe",
    ),
    path.join(
      process.env["ProgramFiles(x86)"] || "",
      "Docker",
      "Docker",
      "Docker Desktop.exe",
    ),
    path.join(
      process.env.LOCALAPPDATA || "",
      "Programs",
      "Docker",
      "Docker Desktop.exe",
    ),
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

function ensureDockerReady(options = {}) {
  const waitMs = options.waitMs ?? 120000;
  const pollMs = options.pollMs ?? 2000;
  const stableWaitMs = options.stableWaitMs ?? 15000;
  const out = options.out ?? console;

  if (process.platform !== "win32") {
    return 0;
  }

  if (process.env.SKIP_DOCKER_PREFLIGHT === "1") {
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
