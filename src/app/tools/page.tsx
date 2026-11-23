"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Boxes, FileJson, Lock, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import type { CustomTool } from "@/lib/shared/types";
import { Button } from "@/components/ui";

export default function ToolsPage() {
  const [data, setData] = useState<{ builtin: { id: string; name: string }[]; custom: CustomTool[] }>();

  useEffect(() => {
    api.tools().then(setData);
  }, []);

  async function remove(t: CustomTool) {
    if (!confirm(`刪除工具「${t.name}」？用它做出的圖會留在圖庫。`)) return;
    await api.deleteTool(t.id);
    setData(await api.tools());
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 md:p-8">
        <header className="flex items-center gap-3">
          <Boxes className="size-5 text-accent" />
          <h1 className="text-lg font-medium">工具</h1>
          <Link href="/tools/import" className="ml-auto">
            <Button variant="primary">
              <Plus className="size-4" /> 匯入 workflow
            </Button>
          </Link>
        </header>
        <p className="-mt-3 text-xs leading-relaxed text-muted">
          把任何 ComfyUI workflow 變成一個簡單的表單。在 ComfyUI 用「Export (API)」匯出 JSON，貼進來後勾選要露出的欄位即可。
          <br />
          小技巧：在 ComfyUI 把節點標題改成 <code className="rounded bg-raised px-1">[UI] 名稱</code>，匯入時會自動勾選並用這個名稱。
        </p>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data?.custom.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-4">
              <div className="flex items-start gap-2">
                <FileJson className="mt-0.5 size-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-medium">{t.name}</h2>
                  {t.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{t.description}</p>}
                </div>
              </div>
              <p className="text-xs text-faint">
                {t.fields.length} 個欄位 · {Object.keys(t.workflow).length} 個節點
              </p>
              <div className="mt-auto flex gap-1 pt-1">
                <Link href={`/tools/${t.id}`}>
                  <Button variant="primary" className="!py-1 text-xs">
                    <Play className="size-3.5" /> 使用
                  </Button>
                </Link>
                <Link href={`/tools/import?id=${t.id}`}>
                  <Button variant="ghost" className="!py-1 text-xs">
                    <Pencil className="size-3.5" /> 編輯欄位
                  </Button>
                </Link>
                <Button variant="danger" className="ml-auto !py-1 text-xs" onClick={() => remove(t)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {data?.builtin.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 rounded-xl border border-line bg-panel/50 p-4">
              <div className="flex items-center gap-2">
                <Lock className="size-4 text-faint" />
                <h2 className="font-medium text-muted">{t.name}</h2>
                <span className="ml-auto rounded bg-raised px-1.5 py-0.5 text-[10px] text-faint">內建</span>
              </div>
              <p className="text-xs text-faint">在「創作」頁使用：{t.id === "qwen21-edit" ? "修改、局部修改、擴圖" : "文字生圖"}</p>
            </div>
          ))}
        </section>
        {data && data.custom.length === 0 && (
          <p className="text-center text-sm text-faint">還沒有匯入的工具。</p>
        )}
      </div>
    </div>
  );
}
