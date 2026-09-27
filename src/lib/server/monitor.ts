import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MonitorSample, ProcGroup, ProcInfo } from "@/lib/shared/monitor";
import { comfy } from "./comfy";
import { getSettings } from "./settings";

// Samples GPU, memory and CPU every 2 s while someone is watching, keeping the
// last 5 minutes. Processes are grouped by what they are for this app:
// ComfyUI, the LLM (LM Studio), the SAM helper, Comfy Studio itself, other.

const INTERVAL = 2000;
const KEEP = 150; // 5 minutes
const IDLE_STOP = 10 * 60_000; // keep sampling a while after the page closes, so coming back shows history

interface State {
  history: MonitorSample[];
  timer?: NodeJS.Timeout;
  watchers: number;
  lastWatch: number;
  prevCpu?: { idle: number; total: number };
  bus: EventEmitter;
}

const st = ((globalThis as unknown as { __monitor?: State }).__monitor ??= {
  history: [],
  watchers: 0,
  lastWatch: 0,
  bus: new EventEmitter().setMaxListeners(50),
});

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout: 4000 }, (err, out) => resolve(err ? "" : out.toString())),
  );
}

function classify(cmdline: string): ProcGroup {
  if (cmdline.includes("sam_server.py")) return "sam";
  if (/ComfyUI|main\.py.*--(lowvram|listen|port|enable)/.test(cmdline) && /python/.test(cmdline)) return "comfy";
  if (/\.lmstudio|lm-studio|LM Studio|llama-server|lms\b/i.test(cmdline)) return "llm";
  if (/^next-server/.test(cmdline) || (cmdline.includes("comfy-studio") && /next|node/.test(cmdline))) return "studio";
  return "other";
}

const pageKb = 4;

/** Every process's group, name and resident memory, straight from /proc. */
function readProcs(): Map<number, ProcInfo> {
  const out = new Map<number, ProcInfo>();
  for (const d of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`, "utf8").replace(/\0/g, " ").trim();
      if (!cmd) continue;
      const statm = fs.readFileSync(`/proc/${d}/statm`, "utf8").split(" ");
      const rssMb = (Number(statm[1]) * pageKb) / 1024;
      const exe = cmd.split(" ")[0];
      out.set(Number(d), { pid: Number(d), group: classify(cmd), name: path.basename(exe), cmd: cmd.slice(0, 200), ramMb: rssMb, vramMb: 0 });
    } catch {
      /* process went away */
    }
  }
  return out;
}

function meminfo() {
  const m = Object.fromEntries(
    fs
      .readFileSync("/proc/meminfo", "utf8")
      .split("\n")
      .map((l) => l.match(/^(\w+):\s+(\d+)/))
      .filter((x): x is RegExpMatchArray => !!x)
      .map((x) => [x[1], Number(x[2]) / 1024]),
  ) as Record<string, number>;
  return {
    totalMb: m.MemTotal,
    usedMb: m.MemTotal - m.MemAvailable,
    swapTotalMb: m.SwapTotal,
    swapUsedMb: m.SwapTotal - m.SwapFree,
  };
}

function cpuPercent() {
  const line = fs.readFileSync("/proc/stat", "utf8").split("\n")[0].split(/\s+/).slice(1).map(Number);
  const idle = line[3] + line[4];
  const total = line.reduce((a, b) => a + b, 0);
  const prev = st.prevCpu;
  st.prevCpu = { idle, total };
  if (!prev || total === prev.total) return 0;
  return 100 * (1 - (idle - prev.idle) / (total - prev.total));
}

async function llmLoaded(): Promise<string[] | null> {
  try {
    const base = getSettings().llmBaseUrl.replace(/\/v1\/?$/, "");
    const res = await fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const d = (await res.json()) as { data?: { id: string; state?: string }[] };
    return (d.data ?? []).filter((m) => m.state === "loaded").map((m) => m.id);
  } catch {
    return null; // not LM Studio, or not running
  }
}

async function comfyQueue() {
  try {
    const res = await fetch(`${comfy.baseUrl}/queue`, { signal: AbortSignal.timeout(1500) });
    const q = (await res.json()) as { queue_running: unknown[]; queue_pending: unknown[] };
    return { online: true, running: q.queue_running.length, pending: q.queue_pending.length };
  } catch {
    return { online: false, running: 0, pending: 0 };
  }
}

export async function sample(): Promise<MonitorSample> {
  const [gpuCsv, appsCsv, llm, queue] = await Promise.all([
    run("nvidia-smi", [
      "--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw,clocks.gr",
      "--format=csv,noheader,nounits",
    ]),
    run("nvidia-smi", ["--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"]),
    llmLoaded(),
    comfyQueue(),
  ]);
  const procs = readProcs();
  for (const line of appsCsv.trim().split("\n").filter(Boolean)) {
    const [pid, mb] = line.split(",").map((s) => s.trim());
    const p = procs.get(Number(pid));
    if (p) p.vramMb = Number(mb) || 0;
  }
  const [name, used, total, util, temp, power, clock] = gpuCsv.split(",").map((s) => s.trim());
  const num = (s?: string) => (s && !isNaN(Number(s)) ? Number(s) : null);

  const groups: ProcGroup[] = ["comfy", "llm", "sam", "studio", "other"];
  const sum = (key: "vramMb" | "ramMb") =>
    Object.fromEntries(groups.map((g) => [g, [...procs.values()].filter((p) => p.group === g).reduce((a, p) => a + p[key], 0)])) as Record<
      ProcGroup,
      number
    >;
  const vram = sum("vramMb");
  const ramGroups = sum("ramMb");
  const mem = meminfo();
  const gpuUsed = num(used) ?? 0;
  // Whatever the per-process list doesn't account for (driver, display) counts as "other".
  vram.other = Math.max(0, gpuUsed - vram.comfy - vram.llm - vram.sam - vram.studio);
  ramGroups.other = Math.max(0, mem.usedMb - ramGroups.comfy - ramGroups.llm - ramGroups.sam - ramGroups.studio);

  const interesting = [...procs.values()]
    .filter((p) => p.group !== "other" || p.vramMb > 0)
    .sort((a, b) => b.vramMb - a.vramMb || b.ramMb - a.ramMb)
    .slice(0, 16);

  return {
    t: Date.now(),
    gpu: {
      name: name ?? "GPU",
      usedMb: gpuUsed,
      totalMb: num(total) ?? 0,
      util: num(util),
      tempC: num(temp),
      powerW: num(power),
      clockMhz: num(clock),
    },
    vram,
    ram: { ...mem, groups: ramGroups },
    cpu: { percent: cpuPercent(), cores: os.cpus().length, load1: os.loadavg()[0] },
    comfy: queue,
    llmLoaded: llm,
    procs: interesting,
  };
}

async function tick() {
  try {
    const s = await sample();
    st.history.push(s);
    if (st.history.length > KEEP) st.history.splice(0, st.history.length - KEEP);
    st.bus.emit("sample", s);
  } catch {
    /* keep ticking */
  }
  if (st.watchers === 0 && Date.now() - st.lastWatch > IDLE_STOP) {
    clearInterval(st.timer);
    st.timer = undefined;
  }
}

/** Start sampling (if needed) and get samples as they come; returns an unsubscribe function. */
export function watch(fn: (s: MonitorSample) => void) {
  st.watchers++;
  st.lastWatch = Date.now();
  if (!st.timer) {
    st.timer = setInterval(tick, INTERVAL);
    void tick();
  }
  st.bus.on("sample", fn);
  return () => {
    st.watchers--;
    st.lastWatch = Date.now();
    st.bus.off("sample", fn);
  };
}

export const history = () => st.history;

// ---- actions -----------------------------------------------------------------

const LMS = path.join(os.homedir(), ".lmstudio", "bin", "lms");

export async function act(action: "free-comfy" | "unload-llm" | "stop-sam") {
  if (action === "free-comfy") return comfy.free();
  if (action === "unload-llm") {
    await run(LMS, ["unload", "--all"]);
    return;
  }
  for (const p of readProcs().values()) if (p.group === "sam" && /python/.test(p.cmd)) process.kill(p.pid, "SIGTERM");
}
