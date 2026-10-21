#!/usr/bin/env node
/**
 * Local sync-and-render daemon.
 *
 * The Octop server builds the job (script.json + assets) inside the agent
 * workspace; this process pulls it down, renders it with the local Remotion
 * installation and pushes the finished mp4 back to the same workspace folder.
 *
 * The server is only ever *pulled from* — the machine never has to be
 * reachable from the internet.
 *
 * Usage:
 *   node sync.mjs --server https://ocbot.aixifs.com/videogen \
 *                 --agent <agent_id> --token <jwt> \
 *                 [--queue render-jobs] [--work ./work] [--interval 30] [--once]
 *
 * The token is the dashboard access token of a user who owns the agent
 * (Dashboard → avatar menu → the token in localStorage, or
 * `octop user login` on a machine that already holds the server's DB).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    server: process.env.OCTOP_SERVER ?? null,
    agent: process.env.OCTOP_AGENT_ID ?? null,
    token: process.env.OCTOP_TOKEN ?? null,
    queue: "render-jobs",
    work: path.join(HERE, "work"),
    interval: 30,
    once: false,
    quality: "prod",
    // Local-only mode: keep the rendered video on this machine and never
    // write back to the server (read-only token is enough).
    upload: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--server") args.server = next();
    else if (arg === "--agent") args.agent = next();
    else if (arg === "--token") args.token = next();
    else if (arg === "--queue") args.queue = next();
    else if (arg === "--work") args.work = path.resolve(next());
    else if (arg === "--interval") args.interval = Number(next());
    else if (arg === "--quality") args.quality = next();
    else if (arg === "--once") args.once = true;
    else if (arg === "--no-upload") args.upload = false;
  }
  return args;
}

class Client {
  constructor(server, agent, token) {
    this.base = server.replace(/\/+$/, "");
    this.agent = agent;
    this.token = token;
  }

  url(apiPath, query = {}) {
    const url = new URL(`${this.base}/api/agents/${this.agent}${apiPath}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
    return url;
  }

  async request(apiPath, query = {}) {
    const res = await fetch(this.url(apiPath, query), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText} ${body.slice(0, 200)}`);
    }
    return res;
  }

  async listDir(dir) {
    const res = await this.request("/workspace/tree", { path: dir });
    return res.json();
  }

  async downloadFile(filePath, dest) {
    const res = await this.request("/workspace/download", { path: filePath });
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
    return buffer.length;
  }

  async uploadFile(localPath, remotePath) {
    const form = new FormData();
    const bytes = fs.readFileSync(localPath);
    form.append("file", new Blob([bytes]), path.basename(localPath));
    const res = await fetch(this.url("/workspace/upload", { path: remotePath }), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`upload failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return res.json();
  }
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) return { done: [] };
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf-8"));
  } catch {
    return { done: [] };
  }
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

function runRender(projectDir, outFile, quality) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(HERE, "render.mjs"), "--project", projectDir, "--out", outFile, "--quality", quality],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`render exited with ${code}`)),
    );
  });
}

async function handleJob(client, jobName, args, state, statePath) {
  const jobDir = `${args.queue}/${jobName}`;
  const localDir = path.join(args.work, jobName);
  const localProject = path.join(localDir, "project");
  const localAssets = path.join(localProject, "assets");
  fs.mkdirSync(localAssets, { recursive: true });

  console.log(`[sync] job ${jobName}: downloading…`);
  await client.downloadFile(`${jobDir}/script.json`, path.join(localProject, "script.json"));

  let assets = [];
  try {
    assets = await client.listDir(`${jobDir}/assets`);
  } catch {
    console.log(`[sync] job ${jobName}: no assets folder`);
  }
  for (const entry of assets) {
    if (entry.is_dir) continue;
    const name = entry.name ?? path.basename(String(entry.path ?? ""));
    if (!name) continue;
    await client.downloadFile(`${jobDir}/assets/${name}`, path.join(localAssets, name));
  }
  console.log(`[sync] job ${jobName}: ${assets.length} asset(s) ready`);

  const outFile = path.join(localProject, "out", "final.mp4");
  console.log(`[sync] job ${jobName}: rendering (${args.quality})…`);
  await runRender(localProject, outFile, args.quality);

  if (args.upload) {
    console.log(`[sync] job ${jobName}: uploading result…`);
    await client.uploadFile(outFile, `${jobDir}/final.mp4`);
  } else {
    console.log(`[sync] job ${jobName}: kept locally → ${outFile}`);
  }

  state.done.push({ job: jobName, at: new Date().toISOString() });
  writeState(statePath, state);
  console.log(`[sync] job ${jobName}: done`);
}

async function poll(client, args) {
  const statePath = path.join(args.work, "state.json");
  const state = readState(statePath);
  const done = new Set(state.done.map((entry) => entry.job));

  let entries = [];
  try {
    entries = await client.listDir(args.queue);
  } catch (err) {
    console.log(`[sync] queue not available yet: ${err.message}`);
    return;
  }

  for (const entry of entries) {
    if (!entry.is_dir) continue;
    const jobName = entry.name ?? path.basename(String(entry.path ?? ""));
    if (!jobName || done.has(jobName)) continue;
    try {
      await handleJob(client, jobName, args, state, statePath);
      done.add(jobName);
    } catch (err) {
      console.error(`[sync] job ${jobName} failed: ${err.message}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.server || !args.agent || !args.token) {
    console.error(
      "usage: node sync.mjs --server <base-url> --agent <agent_id> --token <jwt> " +
        "[--queue render-jobs] [--work ./work] [--interval 30] [--once] [--quality prod]",
    );
    process.exit(2);
  }
  const client = new Client(args.server, args.agent, args.token);
  fs.mkdirSync(args.work, { recursive: true });

  for (;;) {
    await poll(client, args);
    if (args.once) break;
    await new Promise((resolve) => setTimeout(resolve, args.interval * 1000));
  }
}

main().catch((err) => {
  console.error(`[sync] fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
