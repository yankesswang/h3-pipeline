"use client";

import { useState } from "react";
import { Check, Copy, Download, Heart, Pencil, Repeat, Trash2 } from "lucide-react";
import { api, imageUrl } from "@/lib/client/api";
import type { ImageRecord } from "@/lib/shared/types";
import { Button, IconButton } from "./ui";
import { useStudio } from "./studio-provider";

/** Everything known about one image, plus the actions on it. */
export function ImageInfo({
  image,
  onReuse,
  onEdit,
  onDeleted,
}: {
  image: ImageRecord;
  onReuse: (img: ImageRecord, lockSeed: boolean) => void;
  onEdit: (img: ImageRecord) => void;
  onDeleted: (id: string) => void;
}) {
  const { patchImage, removeImage } = useStudio();
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const p = image.params;
  const o = image.origin;
  const uploaded = image.tool === "upload";
  const customTool = image.tool.startsWith("custom:") ? image.tool.slice("custom:".length) : undefined;
  const edited = image.tool === "qwen21-edit";

  async function toggleFavorite() {
    patchImage(await api.setFavorite(image.id, !image.favorite));
  }

  async function remove() {
    await api.deleteImage(image.id);
    removeImage(image.id);
    onDeleted(image.id);
  }

  return (
    <div className="flex flex-col gap-4 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="primary" className="!px-2.5 !py-1 text-xs" onClick={() => onEdit(image)}>
          <Pencil className="size-3.5" /> 修改這張
        </Button>
        {customTool && (
          <a href={`/tools/${customTool}?reuse=${image.id}`}>
            <Button variant="outline" className="!px-2.5 !py-1 text-xs">
              <Repeat className="size-3.5" /> 回到工具
            </Button>
          </a>
        )}
        {!uploaded && !customTool && (
          <Button variant="outline" className="!px-2.5 !py-1 text-xs" onClick={() => onReuse(image, false)} title={edited ? "用同樣的原圖和指令再做一次" : "用同樣的 prompt 和設定"}>
            <Repeat className="size-3.5" /> 重用設定
          </Button>
        )}
        <div className="ml-auto flex">
          <IconButton label={image.favorite ? "取消收藏" : "收藏"} onClick={toggleFavorite}>
            <Heart className={`size-4 ${image.favorite ? "fill-bad text-bad" : ""}`} />
          </IconButton>
          <a href={`${imageUrl(image.id)}?download`} title="下載" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg">
            <Download className="size-4" />
          </a>
          {confirmDelete ? (
            <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={remove} onMouseLeave={() => setConfirmDelete(false)}>
              確定刪除
            </Button>
          ) : (
            <IconButton label="刪除" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
      </div>

      {uploaded ? (
        <p className="text-muted">
          從外部上傳的圖片（{image.width}×{image.height}）
        </p>
      ) : (
        <>
      <Section
        title={p.outpaint ? "擴圖" : p.maskId ? "局部修改指令" : edited ? "修改指令" : "Prompt"}
        action={
          <button
            className="flex items-center gap-1 text-faint hover:text-fg"
            onClick={() => {
              navigator.clipboard.writeText(p.prompt);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "已複製" : "複製"}
          </button>
        }
      >
        <p className="whitespace-pre-wrap leading-relaxed text-fg">{p.prompt}</p>
      </Section>

      {o?.idea && (
        <Section title="原始想法">
          <p className="whitespace-pre-wrap text-fg">{o.idea}</p>
        </Section>
      )}

      {edited && (
        <Section title="用到的圖">
          <div className="flex flex-wrap gap-1.5">
            {[p.sourceImageId, ...(p.refImageIds ?? [])].map((id, i) => (
              <div key={`${id}-${i}`} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(id!, 160)} alt="" className="size-14 rounded-md border border-line object-cover" />
                <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-black/70 text-center font-mono text-[9px]">
                  {i === 0 ? "原圖" : "參考"} {i + 1}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="參數">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <Dt>尺寸</Dt>
          <Dd>
            {image.width}×{image.height}
          </Dd>
          <Dt>Steps / CFG</Dt>
          <Dd>
            {p.steps} / {p.cfg}
          </Dd>
          <Dt>Seed</Dt>
          <Dd className="font-mono">{p.seed}</Dd>
          {p.negativePrompt && (
            <>
              <Dt>負面</Dt>
              <Dd>{p.negativePrompt}</Dd>
            </>
          )}
          <Dt>時間</Dt>
          <Dd>{new Date(image.createdAt).toLocaleString("zh-TW")}</Dd>
          {o?.presetName && (
            <>
              <Dt>範本</Dt>
              <Dd>{o.presetName}</Dd>
            </>
          )}
          {o?.llmModel && (
            <>
              <Dt>LLM</Dt>
              <Dd className="break-all">{o.llmModel}</Dd>
            </>
          )}
        </dl>
      </Section>

      {o?.systemPrompt && (
        <details className="group">
          <summary className="cursor-pointer text-faint hover:text-muted">當時的 system prompt</summary>
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-raised p-2 font-mono text-[11px] text-muted">
            {o.systemPrompt}
          </pre>
        </details>
      )}

      {o?.chat && o.chat.length > 0 && (
        <details>
          <summary className="cursor-pointer text-faint hover:text-muted">當時的對話（{o.chat.length} 則）</summary>
          <div className="mt-2 flex max-h-72 flex-col gap-2 overflow-auto">
            {o.chat.map((m, i) => (
              <div key={i} className={`rounded-lg p-2 ${m.role === "user" ? "bg-accent-strong/15" : "bg-raised"}`}>
                <p className="whitespace-pre-wrap text-muted">{m.content}</p>
              </div>
            ))}
          </div>
        </details>
      )}
        </>
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between text-faint">
        <h3 className="font-medium uppercase tracking-wide">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const Dt = ({ children }: { children: React.ReactNode }) => <dt className="text-faint">{children}</dt>;
const Dd = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <dd className={`text-fg ${className}`}>{children}</dd>
);
