"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, GitBranch, Upload } from "lucide-react";
import { api, imageUrl } from "@/lib/client/api";
import type { ImageRecord } from "@/lib/shared/types";
import { useStudio } from "@/components/studio-provider";

/** All images in `id`'s version tree, refreshed whenever a new image arrives. */
export function useTree(id: string | undefined) {
  const { recent } = useStudio();
  const [tree, setTree] = useState<ImageRecord[]>([]);
  const newest = recent[0]?.id;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    api.tree(id).then((t) => alive && setTree(t), () => {});
    return () => {
      alive = false;
    };
  }, [id, newest]);
  // Until the fetch for a new id lands, don't show another tree.
  return id && tree.some((t) => t.id === id) ? tree : [];
}

/** root → … → current, each step clickable. */
export function lineage(tree: ImageRecord[], id: string): ImageRecord[] {
  const byId = new Map(tree.map((t) => [t.id, t]));
  const path: ImageRecord[] = [];
  for (let cur = byId.get(id); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) path.unshift(cur);
  return path;
}

export function stepLabel(img: ImageRecord) {
  if (img.tool === "upload") return "上傳的原圖";
  if (img.tool === "qwen21-t2i") return "生成";
  return img.params.prompt;
}

/** Thumbnails of the steps that led to the current image, above the stage. */
export function Lineage({
  tree,
  currentId,
  onSelect,
  onShowTree,
}: {
  tree: ImageRecord[];
  currentId: string;
  onSelect: (img: ImageRecord) => void;
  onShowTree: () => void;
}) {
  const path = useMemo(() => lineage(tree, currentId), [tree, currentId]);
  if (tree.length < 2) return null;
  const branches = tree.filter((t) => t.parentId === currentId).length;

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto pb-1">
      {path.map((img, i) => (
        <div key={img.id} className="flex shrink-0 items-center gap-1">
          {i > 0 && <ChevronRight className="size-3.5 text-faint" />}
          <button
            onClick={() => onSelect(img)}
            title={stepLabel(img)}
            className={`flex items-center gap-1.5 rounded-lg border py-0.5 pr-2 pl-0.5 text-xs transition ${
              img.id === currentId ? "border-accent bg-accent-strong/15 text-fg" : "border-line text-muted hover:border-muted hover:text-fg"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(img.id, 160)} alt="" className="size-7 rounded object-cover" />
            <span className="max-w-40 truncate">{i === 0 ? stepLabel(img) : img.params.prompt}</span>
          </button>
        </div>
      ))}
      <button
        onClick={onShowTree}
        className="ml-2 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-faint hover:bg-raised hover:text-fg"
      >
        <GitBranch className="size-3.5" />
        {tree.length} 個版本{branches > 1 ? ` · 這張有 ${branches} 個分支` : ""}
      </button>
    </div>
  );
}

/** The whole tree, indented by generation. */
export function VersionTree({
  tree,
  currentId,
  onSelect,
}: {
  tree: ImageRecord[];
  currentId: string;
  onSelect: (img: ImageRecord) => void;
}) {
  const children = useMemo(() => {
    const m = new Map<string | undefined, ImageRecord[]>();
    const ids = new Set(tree.map((t) => t.id));
    for (const t of tree) {
      const key = t.parentId && ids.has(t.parentId) ? t.parentId : undefined;
      m.set(key, [...(m.get(key) ?? []), t]);
    }
    return m;
  }, [tree]);
  const onPath = useMemo(() => new Set(lineage(tree, currentId).map((i) => i.id)), [tree, currentId]);

  if (tree.length < 2)
    return <p className="text-xs leading-relaxed text-faint">這張圖還沒有其他版本。按「修改這張」後，每次修改都會長在這棵樹上，隨時可以回到任何一步分岔重做。</p>;

  const render = (node: ImageRecord, depth: number) => (
    <div key={node.id}>
      <button
        onClick={() => onSelect(node)}
        className={`flex w-full items-center gap-2 rounded-lg p-1 text-left text-xs transition ${
          node.id === currentId ? "bg-accent-strong/20 ring-1 ring-accent/60" : "hover:bg-raised"
        }`}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {depth > 0 && <span className={`h-px w-2 shrink-0 ${onPath.has(node.id) ? "bg-accent" : "bg-line"}`} />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl(node.id, 160)} alt="" className="size-10 shrink-0 rounded object-cover" />
        <span className="min-w-0 flex-1">
          <span className={`line-clamp-2 ${onPath.has(node.id) ? "text-fg" : "text-muted"}`}>
            {node.tool === "upload" && <Upload className="mr-1 inline size-3" />}
            {depth === 0 ? stepLabel(node) : node.params.prompt}
          </span>
          <span className="text-[10px] text-faint">{new Date(node.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</span>
        </span>
      </button>
      {(children.get(node.id) ?? []).map((c) => render(c, depth + 1))}
    </div>
  );

  return <div className="flex flex-col gap-0.5">{(children.get(undefined) ?? []).map((r) => render(r, 0))}</div>;
}
