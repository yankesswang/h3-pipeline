"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Eye,
  Gauge,
  Loader2,
  MemoryStick,
  OctagonAlert,
  Power,
  Thermometer,
  Trash2,
  WifiOff,
} from "lucide-react";
import { GROUPS, type ModelCatalog, type MonitorSample, type ProcGroup } from "@/lib/shared/monitor";
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

type ActionId = "free-comfy" | "unload-llm" | "stop-sam";
const ACTION: Record<ActionId, { label: string; icon: typeof Power; hint: string }> = {
  "free-comfy": { label: "釋放", icon: Trash2, hint: "卸載 ComfyUI 的模型；下一次生成會重新載入" },
  "unload-llm": { label: "卸載", icon: Power, hint: "LM Studio 卸載所有模型；下次呼叫會自動載入" },
  "stop-sam": { label: "停止", icon: Power, hint: "關掉點選物件的服務；下次點選會自動啟動" },
};

export default function MonitorPage() {
  const [data, setData] = useState<MonitorSample[]>([]);
  const [connected, setConnected] = useState(false);
  const { cat, refresh } = useCatalog();
  const actions = useActions();

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
          "--status-good": "#22c55e",
          "--status-warning": "#fab219",
          "--status-critical": "#f06060",
        } as React.CSSProperties
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 md:p-6">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Activity className="size-5 text-accent" aria-hidden />
          <h1 className="text-lg font-medium">系統監控</h1>
          {now && <span className="text-sm text-faint">{now.gpu.name}</span>}
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
            {connected ? (
              <>
                <span className="size-2 rounded-full bg-ok motion-safe:animate-pulse" aria-hidden />
                即時更新{now && `，${new Date(now.t).toLocaleTimeString("zh-TW")}`}
              </>
            ) : (
              <>
                <WifiOff className="size-3.5 text-bad" aria-hidden />
                連線中斷{now && `，數字停在 ${new Date(now.t).toLocaleTimeString("zh-TW")}`}
              </>
            )}
          </span>
        </header>

        {!now ? (
          <Skeleton />
        ) : (
          <div className={`flex flex-col gap-5 transition-opacity ${connected ? "" : "opacity-60"}`}>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <VramPanel s={now} cat={cat} actions={actions} />
              <Vitals s={now} />
            </div>

            <Card title="切換模型" note={`顯示卡 ${gb(now.gpu.totalMb)} 一次只放得下一個大模型。按「切換」會先清掉其他模型再載入。`}>
              <Models s={now} cat={cat} refresh={refresh} />
            </Card>

            <Trends data={data} s={now} />

            <details className="group rounded-xl border border-line bg-panel">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-5 py-4 font-medium hover:bg-raised/50 focus-visible:outline-2 focus-visible:outline-accent">
                <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" aria-hidden />
                程序明細
                <span className="text-sm font-normal text-faint">{now.procs.length} 個，進階排查用</span>
              </summary>
              <div className="px-5 pb-5">
                <ProcTable s={now} />
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, note, aside, children }: { title: string; note?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <div className="mb-4 flex flex-wrap items-start gap-2">
        <div className="min-w-0">
          <h2 className="font-medium">{title}</h2>
          {note && <p className="mt-0.5 text-sm text-muted">{note}</p>}
        </div>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function StatusIcon({ status, className = "size-4" }: { status: Status; className?: string }) {
  const Icon = status === "good" ? CheckCircle2 : status === "warning" ? AlertTriangle : OctagonAlert;
  return <Icon className={`shrink-0 ${className}`} style={{ color: `var(--status-${status})` }} aria-hidden />;
}

function Skeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" aria-busy>
      <div className="shimmer h-96 rounded-xl" />
      <div className="shimmer h-96 rounded-xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// VRAM: the one number that decides whether generation works, answered first.

/** The largest holder that can be freed right now without interrupting work. */
function suggestion(s: MonitorSample): { id: ActionId; saves: number; who: string } | null {
  const opts: { id: ActionId; saves: number; who: string }[] = [
    { id: "unload-llm", saves: s.vram.llm, who: "LM Studio" },
    { id: "stop-sam", saves: s.vram.sam, who: "SAM 點選" },
    ...(s.comfy.running ? [] : [{ id: "free-comfy" as const, saves: s.vram.comfy, who: "ComfyUI" }]),
  ];
  return opts.filter((o) => o.saves > 512).sort((a, b) => b.saves - a.saves)[0] ?? null;
}

function VramPanel({ s, cat, actions }: { s: MonitorSample; cat?: ModelCatalog; actions: Actions }) {
  const used = s.gpu.usedMb;
  const total = s.gpu.totalMb;
  const free = Math.max(0, total - used);
  const status = level((used / total) * 100, 80, 95);
  const tip = status === "good" ? null : suggestion(s);
  const verdict = {
    good: `還有 ${gb(free)} 可用，可以放心生成。`,
    warning: `只剩 ${gb(free)}。載入新模型前可能要先清出空間。`,
    critical: `只剩 ${gb(free)}，快滿了。生成可能變很慢或失敗。`,
  }[status];

  const resident = s.vram.comfy > 1024 ? cat?.comfyResident : null;
  const residentLabel = resident
    ? (cat?.comfy.find((m) => m.id === resident)?.label ?? (resident.startsWith("custom:") ? `自訂工具「${resident.slice(7)}」` : resident))
    : null;
  const sam = s.procs.some((p) => p.group === "sam");

  const owners: { id: ProcGroup; name: string; state: ReactNode; action?: ActionId }[] = [
    {
      id: "comfy",
      name: "ComfyUI",
      state: !s.comfy.online
        ? <span className="text-[var(--status-critical)]">連不上</span>
        : [
            s.comfy.running ? "正在生成" : "閒置",
            s.comfy.pending ? `排隊 ${s.comfy.pending} 個` : null,
            residentLabel ? `載入 ${residentLabel}` : s.vram.comfy > 1024 ? "有模型（從 ComfyUI 介面載入）" : "沒有模型",
          ].filter(Boolean).join("，"),
      action: s.comfy.online && s.vram.comfy > 1024 && !s.comfy.running ? "free-comfy" : undefined,
    },
    {
      id: "llm",
      name: "LM Studio",
      state:
        s.llmLoaded === null ? "沒有回應" : s.llmLoaded.length ? `載入 ${s.llmLoaded.join("、")}` : "沒有模型，下次呼叫時自動載入",
      action: s.vram.llm > 256 ? "unload-llm" : undefined,
    },
    {
      id: "sam",
      name: "SAM 點選",
      state: sam ? "執行中" : "未啟動，第一次點選時啟動",
      action: sam ? "stop-sam" : undefined,
    },
    { id: "other", name: "其他", state: "桌面、瀏覽器等其他程式" },
  ];

  return (
    <section className="rounded-xl border border-line bg-panel p-5" aria-labelledby="vram-title">
      <h2 id="vram-title" className="text-sm text-muted">
        顯示卡記憶體（VRAM）
      </h2>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-4xl font-semibold tabular-nums tracking-tight">{(used / 1024).toFixed(1)}</span>
        <span className="text-lg text-muted tabular-nums">/ {(total / 1024).toFixed(0)} GB</span>
        <span className="text-sm text-faint tabular-nums">已用 {pct((used / total) * 100)}</span>
      </div>

      <div className="mt-2 flex items-start gap-2 text-sm" role="status">
        <StatusIcon status={status} className="mt-0.5 size-4" />
        <span className="text-fg">{verdict}</span>
      </div>
      {tip && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-raised px-3 py-2 text-sm">
          <span className="text-muted">
            建議：{ACTION[tip.id].label} {tip.who}，可多出約 {gb(tip.saves)}
          </span>
          <ActionButton id={tip.id} actions={actions} variant="outline" label={`${ACTION[tip.id].label} ${tip.who}`} />
        </div>
      )}

      <div className="mt-5">
        <StackedBar
          legend={false}
          height={28}
          total={total}
          format={gb}
          segments={GROUPS.filter((g) => g.id !== "studio").map((g) => ({ id: g.id, label: g.label, value: s.vram[g.id], color: COLOR[g.id] }))}
        />
      </div>

      <h3 className="mt-5 mb-1 text-sm text-muted">誰在使用</h3>
      <ul className="flex flex-col">
        {owners.map((o) => {
          const mb = s.vram[o.id];
          return (
            <li key={o.id} className="flex min-h-12 items-center gap-3 border-t border-line/60 py-2 first:border-t-0">
              <span className="size-3 shrink-0 rounded-sm" style={{ background: COLOR[o.id], opacity: mb > 0.5 ? 1 : 0.35 }} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-fg">{o.name}</div>
                <div className="truncate text-xs text-muted">{o.state}</div>
              </div>
              <span className={`w-16 shrink-0 text-right text-sm tabular-nums ${mb > 0.5 ? "text-fg" : "text-faint"}`}>{mb > 0.5 ? gb(mb) : "0"}</span>
              <div className="w-20 shrink-0 text-right">
                {o.action && <ActionButton id={o.action} actions={actions} variant="ghost" />}
              </div>
            </li>
          );
        })}
        <li className="flex min-h-10 items-center gap-3 border-t border-line/60 pt-2">
          <span className="size-3 shrink-0 rounded-sm bg-line" aria-hidden />
          <span className="flex-1 text-sm text-muted">可用</span>
          <span className="w-16 shrink-0 text-right text-sm tabular-nums text-fg">{gb(free)}</span>
          <span className="w-20 shrink-0" />
        </li>
      </ul>
      {actions.error && <p className="mt-2 text-sm text-bad">操作失敗：{actions.error}</p>}
      <p className="mt-3 text-xs text-faint">釋放或卸載只是把模型移出顯示卡，下次用到時會自動重新載入。</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Vitals: everything else, one row each, with a plain-language state.

function Vitals({ s }: { s: MonitorSample }) {
  const ramPct = (s.ram.usedMb / s.ram.totalMb) * 100;
  const swapPct = s.ram.swapTotalMb ? (s.ram.swapUsedMb / s.ram.swapTotalMb) * 100 : 0;
  const rs = level(ramPct, 80, 92);
  const swapS = level(swapPct, 60, 90);
  const ts = s.gpu.tempC === null ? null : level(s.gpu.tempC, 80, 88);
  const gpuUtil = s.gpu.util;

  return (
    <section className="flex flex-col rounded-xl border border-line bg-panel p-5" aria-label="其他指標">
      <Vital
        icon={Gauge}
        label="GPU 使用率"
        value={gpuUtil === null ? "-" : pct(gpuUtil)}
        meter={gpuUtil ?? undefined}
        note={
          <>
            {gpuUtil === null ? "讀不到" : gpuUtil > 60 ? "忙碌中" : gpuUtil > 5 ? "輕度使用" : "閒置"}
            {s.gpu.powerW !== null && `，${s.gpu.powerW.toFixed(0)} W`}
            {s.gpu.clockMhz !== null && `，${s.gpu.clockMhz} MHz`}
          </>
        }
      />
      <Vital
        icon={Thermometer}
        label="GPU 溫度"
        value={s.gpu.tempC === null ? "-" : `${s.gpu.tempC}°C`}
        status={ts ?? undefined}
        note={ts === null ? "讀不到" : { good: "正常", warning: "偏熱，注意散熱", critical: "過熱，建議暫停生成" }[ts]}
      />
      <Vital
        icon={MemoryStick}
        label="系統記憶體（RAM）"
        value={`${(s.ram.usedMb / 1024).toFixed(1)} / ${(s.ram.totalMb / 1024).toFixed(0)} GB`}
        meter={ramPct}
        status={rs}
        note={
          <>
            {{ good: "正常", warning: "偏高", critical: "快滿了" }[rs]}
            {s.ram.swapTotalMb > 0 && s.ram.swapUsedMb > 256 && (
              <span style={{ color: swapS === "good" ? undefined : `var(--status-${swapS})` }}>
                ，交換空間用了 {gb(s.ram.swapUsedMb)}
                {swapS !== "good" && "（會變慢）"}
              </span>
            )}
          </>
        }
      />
      <Vital
        icon={Cpu}
        label="CPU"
        value={pct(s.cpu.percent)}
        meter={s.cpu.percent}
        note={`${s.cpu.cores} 核，負載 ${s.cpu.load1.toFixed(1)}`}
      />
    </section>
  );
}

function Vital({
  icon: Icon,
  label,
  value,
  note,
  meter,
  status,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  note: ReactNode;
  meter?: number;
  status?: Status;
}) {
  const fill = status && status !== "good" ? `var(--status-${status})` : "var(--color-muted)";
  return (
    <div className="flex flex-1 flex-col justify-center gap-1.5 border-t border-line/60 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted" aria-hidden />
        <span className="text-sm text-muted">{label}</span>
        <span className="ml-auto text-lg font-medium tabular-nums">{value}</span>
      </div>
      {meter !== undefined && (
        <div className="h-1.5 overflow-hidden rounded-full bg-line/70" role="meter" aria-label={label} aria-valuenow={Math.round(meter)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, meter)}%`, background: fill }} />
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {status && <StatusIcon status={status} className="size-3.5" />}
        <span>{note}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions: shared so the suggestion and the per-row buttons show the same state.

interface Actions {
  busy: ActionId | null;
  done: ActionId | null;
  error?: string;
  run: (id: ActionId) => void;
}

function useActions(): Actions {
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [done, setDone] = useState<ActionId | null>(null);
  const [error, setError] = useState<string>();
  async function run(id: ActionId) {
    setBusy(id);
    setError(undefined);
    try {
      const res = await fetch("/api/monitor/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: id }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      setDone(id);
      setTimeout(() => setDone(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  return { busy, done, error, run: (id) => void run(id) };
}

function ActionButton({ id, actions, variant, label }: { id: ActionId; actions: Actions; variant: "ghost" | "outline"; label?: string }) {
  const a = ACTION[id];
  return (
    <Button variant={variant} className="!min-h-8 !px-2.5 !py-1 text-xs" title={a.hint} onClick={() => actions.run(id)} disabled={actions.busy !== null}>
      {actions.busy === id ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : actions.done === id ? (
        <CheckCircle2 className="size-3.5 text-ok" aria-hidden />
      ) : (
        <a.icon className="size-3.5" aria-hidden />
      )}
      {actions.done === id ? "完成" : (label ?? a.label)}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Trends: one chart at a time, picked by tab.

type TrendTab = "vram" | "ram" | "load";

function Trends({ data, s }: { data: MonitorSample[]; s: MonitorSample }) {
  const [tab, setTab] = useState<TrendTab>("vram");
  const tabs: { id: TrendTab; label: string }[] = [
    { id: "vram", label: "VRAM" },
    { id: "ram", label: "RAM" },
    { id: "load", label: "GPU / CPU 使用率" },
  ];
  const vramGroups = GROUPS.filter((g) => g.id !== "studio");

  return (
    <Card
      title="過去 5 分鐘"
      note="把游標移到圖上看每個時間點的數值。"
      aside={
        <div role="tablist" aria-label="選擇圖表" className="flex rounded-lg border border-line p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`min-h-8 rounded-md px-3 text-xs transition focus-visible:outline-2 focus-visible:outline-accent ${
                tab === t.id ? "bg-raised text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      <div role="tabpanel">
        {tab === "vram" && (
          <TimeChart
            data={data}
            stacked
            height={220}
            max={s.gpu.totalMb}
            ticks={[0, 4096, 8192, 12288, 16384, 24576, 32768].filter((t) => t <= s.gpu.totalMb)}
            format={gb}
            series={vramGroups.map((g): TimeSeries<MonitorSample> => ({ id: g.id, label: g.label, color: COLOR[g.id], get: (d) => d.vram[g.id] }))}
          />
        )}
        {tab === "ram" && (
          <TimeChart
            data={data}
            stacked
            height={220}
            max={s.ram.totalMb}
            ticks={[0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(s.ram.totalMb * f))}
            format={gb}
            series={GROUPS.map((g): TimeSeries<MonitorSample> => ({ id: g.id, label: g.label, color: COLOR[g.id], get: (d) => d.ram.groups[g.id] }))}
          />
        )}
        {tab === "load" && (
          <TimeChart
            data={data}
            max={100}
            height={220}
            ticks={[0, 25, 50, 75, 100]}
            format={pct}
            series={[
              { id: "gpu", label: "GPU", color: "var(--color-accent)", get: (d) => d.gpu.util },
              { id: "cpu", label: "CPU", color: "var(--color-muted)", dash: true, get: (d) => d.cpu.percent },
            ]}
          />
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ProcTable({ s }: { s: MonitorSample }) {
  const label = Object.fromEntries(GROUPS.map((g) => [g.id, g.label])) as Record<ProcGroup, string>;
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="sticky top-0 bg-panel text-left text-xs text-faint">
          <tr>
            <th className="py-2 pr-3 font-normal">類別</th>
            <th className="py-2 pr-3 font-normal">程序</th>
            <th className="py-2 pr-3 font-normal">PID</th>
            <th className="py-2 pr-3 text-right font-normal">VRAM</th>
            <th className="py-2 text-right font-normal">RAM</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {s.procs.map((p) => (
            <tr key={p.pid} className="border-t border-line/60" title={p.cmd}>
              <td className="py-1.5 pr-3">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="size-2.5 rounded-sm" style={{ background: COLOR[p.group] }} aria-hidden />
                  {label[p.group]}
                </span>
              </td>
              <td className="max-w-64 truncate py-1.5 pr-3 font-mono text-xs text-muted">{p.name}</td>
              <td className="py-1.5 pr-3 text-xs text-faint">{p.pid}</td>
              <td className={`py-1.5 pr-3 text-right ${p.vramMb ? "" : "text-faint"}`}>{p.vramMb ? gb(p.vramMb) : "-"}</td>
              <td className="py-1.5 text-right">{gb(p.ramMb)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Models: which one holds the GPU, and a button to switch to any other.

function useCatalog() {
  const [cat, setCat] = useState<ModelCatalog>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const next = await fetch("/api/models")
        .then((r) => r.json() as Promise<ModelCatalog>)
        .catch(() => undefined);
      if (!alive) return;
      if (next) setCat(next);
      timer = setTimeout(load, next?.switching ? 1500 : 5000);
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tick]);
  return { cat, refresh: () => setTick((t) => t + 1) };
}

function Models({ s, cat, refresh }: { s: MonitorSample; cat?: ModelCatalog; refresh: () => void }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<string>();
  const switching = cat?.switching ?? (pending ? { target: pending, stage: "準備中" } : null);

  async function switchTo(target: string) {
    setError(undefined);
    setPending(target);
    try {
      const res = await fetch("/api/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target }) });
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      else refresh();
    } finally {
      setPending(undefined);
    }
  }

  if (!cat) return <div className="shimmer h-32 rounded-lg" />;

  const comfyHolds = s.vram.comfy > 1024; // below this ComfyUI holds no model, just its runtime
  const resident = comfyHolds ? cat.comfyResident : null;
  const loadedLlms = new Set(s.llmLoaded ?? []);
  const generating = s.comfy.running > 0;
  const disabled = !!switching || generating;

  const row = (o: { key: string; color: string; name: ReactNode; detail: ReactNode; loaded: boolean; vramMb?: number; onSwitch: () => void }) => {
    const busy = switching?.target === o.key;
    return (
      <div key={o.key} className={`flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 ${o.loaded ? "bg-raised" : ""}`}>
        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: o.color, opacity: o.loaded ? 1 : 0.35 }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm ${o.loaded ? "text-fg" : "text-muted"}`}>{o.name}</div>
          <div className="truncate text-xs text-faint">{o.detail}</div>
        </div>
        {busy ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-accent" role="status">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> {switching.stage}…
          </span>
        ) : o.loaded ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
            <StatusIcon status="good" className="size-3.5" />
            使用中{o.vramMb ? `，${gb(o.vramMb)}` : ""}
          </span>
        ) : (
          <Button
            variant="ghost"
            className="!min-h-8 !px-2.5 !py-1 text-xs"
            disabled={disabled}
            onClick={o.onSwitch}
            title={generating ? "正在生成，等完成再切換" : "清掉其他模型，載入這個"}
          >
            <ArrowRightLeft className="size-3.5" aria-hidden /> 切換
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {(error || cat.lastError) && (
        <p className="flex items-center gap-1.5 text-sm text-bad" role="alert">
          <StatusIcon status="critical" className="size-4" /> 切換失敗：{error ?? cat.lastError}
        </p>
      )}
      {generating && !switching && (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> ComfyUI 正在生成，完成後才能切換。
        </p>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <h3 className="mb-1 flex items-baseline gap-2 text-sm">
            <span className="text-fg">圖片 / 影片（ComfyUI）</span>
            <span className="text-xs text-faint">VRAM {gb(s.vram.comfy)}，RAM {gb(s.ram.groups.comfy)}</span>
          </h3>
          {cat.comfy.map((m) =>
            row({
              key: m.id,
              color: COLOR.comfy,
              name: m.label,
              detail: m.desc,
              loaded: resident === m.id,
              vramMb: s.vram.comfy,
              onSwitch: () => void switchTo(m.id),
            }),
          )}
          {comfyHolds && !cat.comfy.some((m) => m.id === resident) && (
            <p className="px-3 py-2 text-xs text-muted">
              {resident?.startsWith("custom:")
                ? `自訂工具「${resident.slice(7)}」的模型，佔 ${gb(s.vram.comfy)}`
                : `有模型佔用 ${gb(s.vram.comfy)}（從 ComfyUI 介面執行的，這裡看不到名稱）`}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="mb-1 flex items-baseline gap-2 text-sm">
            <span className="text-fg">提示詞助手（LM Studio）</span>
            <span className="text-xs text-faint">
              VRAM {gb(s.vram.llm)}，RAM {gb(s.ram.groups.llm)}
              {s.llmLoaded === null && "，沒有回應"}
            </span>
          </h3>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {cat.llms.length === 0 && <p className="px-3 py-2 text-xs text-faint">找不到 LM Studio 的模型（需要 lms 指令）</p>}
            {cat.llms.map((m) => {
              const tooBig = m.sizeMb > s.gpu.totalMb * 0.9;
              return row({
                key: m.key,
                color: COLOR.llm,
                name: (
                  <span className="flex items-center gap-1.5">
                    {m.label}
                    {m.vision && <Eye className="size-3 shrink-0 text-faint" aria-label="看得懂圖" />}
                    {cat.currentLlm === m.key && <span className="rounded bg-accent-strong/25 px-1.5 text-[11px] text-accent">助手用這個</span>}
                  </span>
                ),
                detail: (
                  <>
                    {[m.params, m.quant, `約 ${gb(m.sizeMb)}`].filter(Boolean).join("，")}
                    {tooBig && <span style={{ color: "var(--status-warning)" }}>，比 VRAM 大，部分會放 RAM（較慢）</span>}
                  </>
                ),
                loaded: loadedLlms.has(m.key),
                vramMb: loadedLlms.size === 1 ? s.vram.llm : undefined,
                onSwitch: () => void switchTo(m.key),
              });
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
