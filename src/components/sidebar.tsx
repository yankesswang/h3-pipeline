"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Images, ScrollText, Settings, Sparkles } from "lucide-react";
import { useStudio } from "./studio-provider";

const NAV = [
  { href: "/", label: "創作", icon: Sparkles },
  { href: "/gallery", label: "圖庫", icon: Images },
  { href: "/presets", label: "Prompt 庫", icon: ScrollText },
  { href: "/settings", label: "設定", icon: Settings },
];

export function Sidebar() {
  const path = usePathname();
  const { status, jobs } = useStudio();
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running").length;

  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-4">
      <div className="mb-4 grid size-9 place-items-center rounded-xl bg-accent-strong font-semibold text-white">C</div>
      {NAV.map(({ href, label, icon: Icon }) => {
        const on = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`relative flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[11px] transition ${
              on ? "bg-raised text-fg" : "text-muted hover:bg-raised/60 hover:text-fg"
            }`}
          >
            <Icon className="size-5" strokeWidth={1.75} />
            {label}
            {href === "/" && active > 0 && (
              <span className="absolute top-1 right-2 grid min-w-4 place-items-center rounded-full bg-accent-strong px-1 text-[10px] text-white">
                {active}
              </span>
            )}
          </Link>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-2 text-[10px] text-faint">
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
