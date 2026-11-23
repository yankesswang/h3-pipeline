// System monitor data, shared by the sampler and the dashboard.

export type ProcGroup = "comfy" | "llm" | "sam" | "studio" | "other";

export const GROUPS: { id: ProcGroup; label: string }[] = [
  { id: "comfy", label: "ComfyUI" },
  { id: "llm", label: "LM Studio" },
  { id: "sam", label: "SAM 點選" },
  { id: "studio", label: "Comfy Studio" },
  { id: "other", label: "其他" },
];

/** Models the monitor can switch the GPU to. */
export interface ModelCatalog {
  /** What this app runs in ComfyUI. */
  comfy: { id: string; label: string; desc: string }[];
  /** LM Studio's chat models. */
  llms: { key: string; label: string; sizeMb: number; params?: string; quant?: string; vision: boolean }[];
  /** The model this app last ran in ComfyUI; null when unknown or freed. */
  comfyResident: string | null;
  /** The model the prompt assistant uses. */
  currentLlm: string;
  switching: { target: string; stage: string } | null;
  lastError?: string;
}

export interface ProcInfo {
  pid: number;
  group: ProcGroup;
  name: string;
  cmd: string;
  ramMb: number;
  vramMb: number;
}

export interface MonitorSample {
  t: number;
  gpu: {
    name: string;
    usedMb: number;
    totalMb: number;
    util: number | null;
    tempC: number | null;
    powerW: number | null;
    clockMhz: number | null;
  };
  /** VRAM by group, MiB. */
  vram: Record<ProcGroup, number>;
  ram: { totalMb: number; usedMb: number; swapTotalMb: number; swapUsedMb: number; groups: Record<ProcGroup, number> };
  cpu: { percent: number; cores: number; load1: number };
  comfy: { online: boolean; running: number; pending: number };
  /** Models LM Studio has loaded; null when it can't be asked. */
  llmLoaded: string[] | null;
  procs: ProcInfo[];
}
