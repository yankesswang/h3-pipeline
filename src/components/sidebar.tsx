"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Boxes, Clapperboard, ImagePlus, Images, Layers, ScrollText, Settings, Sparkles, SquareStack } from "lucide-react";
import { useStudio } from "./studio-provider";

const NAV = [
  { href: "/", label: "圖片", icon: Sparkles },
  { href: "/image", label: "生圖", icon: ImagePlus },
  { href: "/video", label: "影片", icon: Clapperboard },
  { href: "/gallery", label: "圖庫", icon: Images },
  { href: "/batch", label: "批次", icon: SquareStack },
  { href: "/tools", label: "工具", icon: Boxes },
  { href: "/loras", label: "LoRA", icon: Layers },
  { href: "/presets", label: "Prompt 庫", icon: ScrollText },
  { href: "/monitor", label: "監控", icon: Activity },
  { href: "/settings", label: "設定", icon: Settings },
];

export function Sidebar() {
  const path = usePathname();
  const { status, jobs } = useStudio();
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running").length;

  return (
    // Phones: a scrolling tab bar along the bottom; wider screens: a rail on the left.
    <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-line bg-panel px-1 pb-[env(safe-area-inset-bottom)] md:w-[72px] md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-t-0 md:border-r md:px-0 md:py-4">
      <div className="mb-4 hidden size-9 shrink-0 place-items-center rounded-xl bg-accent-strong font-semibold text-white md:grid">C</div>
      {NAV.map(({ href, label, icon: Icon }) => {
        const on = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`relative flex w-14 shrink-0 flex-col items-center gap-1 rounded-lg py-2 text-[11px] whitespace-nowrap transition ${
              on ? "bg-raised text-fg" : "text-muted hover:bg-raised/60 hover:text-fg"
            }`}
          >
            <Icon className="size-5" strokeWidth={1.75} />
            {label}
            {href === "/monitor" && status?.vramPct != null && (
              <span
                title={`VRAM ${status.vramPct}%`}
                className={`absolute top-1 right-1 rounded px-1 text-[9px] leading-3.5 tabular-nums ${
                  status.vramPct >= 95 ? "bg-bad text-white" : status.vramPct >= 80 ? "bg-[#fab219] text-black" : "bg-raised text-muted"
                }`}
              >
                {status.vramPct}%
              </span>
            )}
            {href === "/" && active > 0 && (
              <span className="absolute top-1 right-2 grid min-w-4 place-items-center rounded-full bg-accent-strong px-1 text-[10px] text-white">
                {active}
              </span>
            )}
          </Link>
        );
      })}
      <div className="flex shrink-0 items-center gap-2 px-2 text-[10px] text-faint md:mt-auto md:flex-col md:px-0">
        <StatusDot ok={status?.comfy} label="ComfyUI" />
        <StatusDot ok={status?.llm} label="LLM" />
      </div>
    </nav>
  );
}

function StatusDot({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1" title={`${label}：${ok ? "已連線" : "未連線"}`}>
      <span className={`size-2 rounded-full ${ok === undefined ? "bg-faint" : ok ? "bg-ok" : "bg-bad"}`} />
      {label}
    </div>
  );
}
