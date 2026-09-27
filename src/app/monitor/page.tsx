"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, CheckCircle2, Cpu, Loader2, OctagonAlert, Power, Trash2 } from "lucide-react";
import { GROUPS, type MonitorSample, type ProcGroup } from "@/lib/shared/monitor";
import { StackedBar, TimeChart, type TimeSeries } from "@/components/monitor/charts";
import { Button } from "@/components/ui";

// Series slots, validated as a set on the app's dark panel (#15171c): all
// adjacent pairs clear CVD ΔE 8 and the normal-vision floor. "Other" is neutral.
const COLOR: Record<ProcGroup, string> = {
  comfy: "var(--series-comfy)",
  llm: "var(--series-llm)",
  sam: "var(--series-sam)",
  studio: "var(--series-studio)",
  other: "var(--series-other)",
};

const gb = (mb: number) => (mb < 1000 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`);
const pct = (v: number) => `${Math.round(v)}%`;

type Status = "good" | "warning" | "critical";
const level = (v: number, warn: number, crit: number): Status => (v >= crit ? "critical" : v >= warn ? "warning" : "good");

export default function MonitorPage() {
  const [data, setData] = useState<MonitorSample[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/monitor/stream");
    es.addEventListener("history", (e) => setData(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("sample", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as MonitorSample;
      setData((d) => [...d.filter((x) => x.t > s.t - 5 * 60_000 && x.t !== s.t), s]);
    });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const now = data[data.length - 1];

  return (
    <div
      className="h-full overflow-y-auto"
      style={
        {
          "--series-comfy": "#3987e5",
          "--series-llm": "#d95926",
          "--series-sam": "#199e70",
          "--series-studio": "#c98500",
          "--series-other": "#5b6273",
          "--status-good": "#0ca30c",
          "--status-warning": "#fab219",
          "--status-critical": "#d03b3b",
        } as React.CSSProperties
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
        <header className="flex items-center gap-3">
          <Activity className="size-5 text-accent" />
          <h1 className="text-lg font-medium">系統監控</h1>
          {now && <span className="text-xs text-faint">{now.gpu.name}</span>}
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            <span className={`size-2 rounded-full ${connected ? "animate-pulse bg-ok" : "bg-bad"}`} />
            {connected ? "即時 · 每 2 秒" : "連線中斷"}
          </span>
        </header>

        {!now ? (
          <div className="grid h-64 place-items-center text-faint">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <>
            <Tiles s={now} />

            <Card
              title="GPU 記憶體（VRAM）"
              aside={
                <Actions
                  actions={[
                    { id: "free-comfy", label: "釋放 ComfyUI", icon: Trash2, hint: "卸載 ComfyUI 的模型；下一次生成會重新載入" },
                    { id: "unload-llm", label: "卸載 LLM", icon: Power, hint: "LM Studio 卸載所有模型；下次呼叫會自動載入" },
                    { id: "stop-sam", label: "停止 SAM", icon: Power, hint: "關掉點選物件的服務；下次點選會自動啟動" },
                  ]}
                />
              }
            >
              <StackedBar
                total={now.gpu.totalMb}
                format={gb}
                segments={GROUPS.filter((g) => g.id !== "studio").map((g) => ({ id: g.id, label: g.label, value: now.vram[g.id], color: COLOR[g.id] }))}
              />
              <div className="mt-5">
                <TimeChart
                  data={data}
                  stacked
                  legend={false}
                  max={now.gpu.totalMb}
                  ticks={[0, 4096, 8192, 12288, 16384].filter((t) => t <= now.gpu.totalMb)}
                  format={gb}
                  series={GROUPS.filter((g) => g.id !== "studio").map(
                    (g): TimeSeries<MonitorSample> => ({ id: g.id, label: g.label, color: COLOR[g.id], get: (d) => d.vram[g.id] }),
                  )}
                />
              </div>
            </Card>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Card title="系統記憶體（RAM）">
                <StackedBar
                  total={now.ram.totalMb}
                  format={gb}
                  segments={GROUPS.map((g) => ({ id: g.id, label: g.label, value: now.ram.groups[g.id], color: COLOR[g.id] }))}
                />
                <div className="mt-5">
                  <TimeChart
                    data={data}
                    stacked
                    legend={false}
                    max={now.ram.totalMb}
                    ticks={[0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(now.ram.totalMb * f))}
                    format={gb}
                    series={GROUPS.map((g): TimeSeries<MonitorSample> => ({ id: g.id, label: g.label, color: COLOR[g.id], get: (d) => d.ram.groups[g.id] }))}
                  />
                </div>
              </Card>

              <Card title="使用率">
                <TimeChart
                  data={data}
                  max={100}
                  ticks={[0, 25, 50, 75, 100]}
                  format={pct}
                  height={220}
                  series={[
                    { id: "gpu", label: "GPU", color: "var(--series-comfy)", get: (d) => d.gpu.util },
                    { id: "cpu", label: "CPU", color: "var(--series-llm)", get: (d) => d.cpu.percent },
                  ]}
                />
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_2fr]">
              <Card title="服務">
                <Services s={now} />
              </Card>
              <Card title="程序">
                <ProcTable s={now} />
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{title}</h2>
        <div className="ml-auto">{aside}</div>
      </div>
      {children}
    </section>
  );
}

function StatusBadge({ status, children }: { status: Status; children: ReactNode }) {
  const Icon = status === "good" ? CheckCircle2 : status === "warning" ? AlertTriangle : OctagonAlert;
  return (
    <span className="flex items-center gap-1 text-xs" style={{ color: `var(--status-${status})` }}>
      <Icon className="size-3.5" />
      <span className="text-muted">{children}</span>
    </span>
  );
}

function Tile({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-panel px-4 py-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-2xl font-medium text-fg">
        {value}
        {unit && <span className="ml-1 text-sm text-muted">{unit}</span>}
      </span>
      {sub}
    </div>
  );
}

function Tiles({ s }: { s: MonitorSample }) {
  const vramPct = (s.gpu.usedMb / s.gpu.totalMb) * 100;
  const ramPct = (s.ram.usedMb / s.ram.totalMb) * 100;
  const swapPct = s.ram.swapTotalMb ? (s.ram.swapUsedMb / s.ram.swapTotalMb) * 100 : 0;
  const vs = level(vramPct, 80, 95);
  const rs = level(ramPct, 80, 92);
  const ss = level(swapPct, 60, 90);
  const ts = level(s.gpu.tempC ?? 0, 80, 88);
  const say = { good: "正常", warning: "偏高", critical: "快滿了" };
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile
        label="VRAM"
        value={(s.gpu.usedMb / 1024).toFixed(1)}
        unit={`/ ${(s.gpu.totalMb / 1024).toFixed(0)} GB`}
        sub={<StatusBadge status={vs}>{pct(vramPct)} · {say[vs]}</StatusBadge>}
      />
      <Tile label="GPU 使用率" value={s.gpu.util === null ? "—" : String(s.gpu.util)} unit="%" sub={<span className="text-xs text-faint">{s.gpu.clockMhz ?? "—"} MHz</span>} />
      <Tile
        label="GPU 溫度"
        value={s.gpu.tempC === null ? "—" : String(s.gpu.tempC)}
        unit="°C"
        sub={<StatusBadge status={ts}>{ts === "good" ? "正常" : ts === "warning" ? "偏熱" : "過熱"}</StatusBadge>}
      />
      <Tile label="GPU 功耗" value={s.gpu.powerW === null ? "—" : s.gpu.powerW.toFixed(0)} unit="W" />
      <Tile
        label="RAM"
        value={(s.ram.usedMb / 1024).toFixed(1)}
        unit={`/ ${(s.ram.totalMb / 1024).toFixed(0)} GB`}
        sub={
          <div className="flex flex-col gap-0.5">
            <StatusBadge status={rs}>{pct(ramPct)} · {say[rs]}</StatusBadge>
            {s.ram.swapTotalMb > 0 && (
              <StatusBadge status={ss}>
                Swap {gb(s.ram.swapUsedMb)} / {gb(s.ram.swapTotalMb)}
              </StatusBadge>
            )}
          </div>
        }
      />
      <Tile
        label="CPU"
        value={s.cpu.percent.toFixed(0)}
        unit="%"
        sub={
          <span className="flex items-center gap-1 text-xs text-faint">
            <Cpu className="size-3" /> {s.cpu.cores} 核 · 負載 {s.cpu.load1.toFixed(1)}
          </span>
        }
      />
    </div>
  );
}

function Actions({ actions }: { actions: { id: string; label: string; icon: typeof Power; hint: string }[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(id: string) {
    setBusy(id);
    try {
      await fetch("/api/monitor/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: id }) });
      setDone(id);
      setTimeout(() => setDone(null), 2000);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-wrap gap-1">
      {actions.map((a) => (
        <Button key={a.id} variant="ghost" className="!px-2 !py-1 text-xs" title={a.hint} onClick={() => run(a.id)} disabled={busy !== null}>
          {busy === a.id ? <Loader2 className="size-3.5 animate-spin" /> : done === a.id ? <CheckCircle2 className="size-3.5 text-ok" /> : <a.icon className="size-3.5" />}
          {a.label}
        </Button>
      ))}
    </div>
  );
}

function Services({ s }: { s: MonitorSample }) {
  const sam = s.procs.some((p) => p.group === "sam");
  const row = (color: string, name: string, state: ReactNode) => (
    <div className="flex items-start gap-3 py-2">
      <span className="mt-1.5 size-2.5 shrink-0 rounded-sm" style={{ background: color }} />
      <div className="min-w-0">
        <div className="text-sm">{name}</div>
        <div className="text-xs text-muted">{state}</div>
      </div>
    </div>
  );
  return (
    <div className="flex flex-col divide-y divide-line">
      {row(
        COLOR.comfy,
        "ComfyUI",
        s.comfy.online ? (
          <StatusBadge status="good">
            在線 · {s.comfy.running ? "執行中" : "閒置"}
            {s.comfy.pending ? ` · 排隊 ${s.comfy.pending}` : ""} · VRAM {gb(s.vram.comfy)}
          </StatusBadge>
        ) : (
          <StatusBadge status="critical">連不上</StatusBadge>
        ),
      )}
      {row(
        COLOR.llm,
        "LM Studio",
        s.llmLoaded === null ? (
          <span className="text-faint">沒有回應（或不是用 LM Studio）</span>
        ) : s.llmLoaded.length ? (
          <StatusBadge status="good">
            已載入 {s.llmLoaded.join("、")} · VRAM {gb(s.vram.llm)}
          </StatusBadge>
        ) : (
          <span className="text-faint">沒有載入模型（下次呼叫時自動載入）</span>
        ),
      )}
      {row(
        COLOR.sam,
        "SAM 點選",
        sam ? <StatusBadge status="good">執行中 · VRAM {gb(s.vram.sam)}</StatusBadge> : <span className="text-faint">未啟動（第一次點選時啟動）</span>,
      )}
    </div>
  );
}

function ProcTable({ s }: { s: MonitorSample }) {
  const label = Object.fromEntries(GROUPS.map((g) => [g.id, g.label])) as Record<ProcGroup, string>;
  return (
    <div className="max-h-72 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-panel text-left text-faint">
          <tr>
            <th className="py-1.5 pr-3 font-normal">PID</th>
            <th className="py-1.5 pr-3 font-normal">類別</th>
            <th className="py-1.5 pr-3 font-normal">程序</th>
            <th className="py-1.5 pr-3 text-right font-normal">VRAM</th>
            <th className="py-1.5 text-right font-normal">RAM</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {s.procs.map((p) => (
            <tr key={p.pid} className="border-t border-line/60" title={p.cmd}>
              <td className="py-1.5 pr-3 text-muted">{p.pid}</td>
              <td className="py-1.5 pr-3">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm" style={{ background: COLOR[p.group] }} />
                  {label[p.group]}
                </span>
              </td>
              <td className="max-w-64 truncate py-1.5 pr-3 font-mono text-muted">{p.name}</td>
              <td className="py-1.5 pr-3 text-right">{p.vramMb ? gb(p.vramMb) : "—"}</td>
              <td className="py-1.5 text-right">{gb(p.ramMb)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
