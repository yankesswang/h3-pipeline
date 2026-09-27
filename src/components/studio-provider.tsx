"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import type { ImageRecord, Job, Preset, ServerEvent } from "@/lib/shared/types";

interface StudioState {
  jobs: Job[];
  /** Newest first. */
  recent: ImageRecord[];
  presets: Preset[];
  reloadPresets: () => Promise<void>;
  status: { comfy: boolean; llm: boolean; llmModel: string } | null;
  refreshStatus: () => Promise<void>;
  /** Called by pages that change images, so the strip stays in sync. */
  patchImage: (img: ImageRecord) => void;
  removeImage: (id: string) => void;
  /** Listen to raw server events (e.g. to react when a job finishes). Returns an unsubscribe function. */
  subscribe: (fn: (ev: ServerEvent) => void) => () => void;
}

const Ctx = createContext<StudioState | null>(null);

export function useStudio() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStudio outside StudioProvider");
  return v;
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [recent, setRecent] = useState<ImageRecord[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [status, setStatus] = useState<StudioState["status"]>(null);
  const [listeners] = useState(() => new Set<(ev: ServerEvent) => void>());
  const subscribe = useCallback(
    (fn: (ev: ServerEvent) => void) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    [listeners],
  );

  const reloadPresets = useCallback(async () => setPresets(await api.presets()), []);
  const refreshStatus = useCallback(async () => setStatus(await api.status().catch(() => null)), []);

  useEffect(() => {
    api.jobs().then(setJobs).catch(() => {});
    api.images({ limit: 40 }).then(setRecent).catch(() => {});
    api.presets().then(setPresets).catch(() => {});
    api.status().then(setStatus, () => setStatus(null));
    const t = setInterval(refreshStatus, 15_000);

    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as ServerEvent;
      for (const fn of listeners) fn(ev);
      if (ev.type === "job")
        setJobs((js) => {
          const i = js.findIndex((j) => j.id === ev.job.id);
          if (i < 0) return [...js, ev.job];
          const next = js.slice();
          next[i] = ev.job;
          return next;
        });
      else if (ev.type === "image") setRecent((r) => [ev.image, ...r.filter((x) => x.id !== ev.image.id)]);
    };
    // A reconnect may have missed events; resync.
    es.onopen = () => api.jobs().then(setJobs).catch(() => {});
    return () => {
      clearInterval(t);
      es.close();
    };
  }, [reloadPresets, refreshStatus, listeners]);

  const patchImage = useCallback(
    (img: ImageRecord) => setRecent((r) => r.map((x) => (x.id === img.id ? img : x))),
    [],
  );
  const removeImage = useCallback((id: string) => setRecent((r) => r.filter((x) => x.id !== id)), []);

  return (
    <Ctx.Provider value={{ jobs, recent, presets, reloadPresets, status, refreshStatus, patchImage, removeImage, subscribe }}>
      {children}
    </Ctx.Provider>
  );
}
