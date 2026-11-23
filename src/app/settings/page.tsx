"use client";

import { useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { api, type PublicSettings } from "@/lib/client/api";
import { useStudio } from "@/components/studio-provider";
import { Button, Select, inputCls } from "@/components/ui";

const LLM_PRESETS = [
  { label: "LM Studio（本機）", url: "http://127.0.0.1:1234/v1" },
  { label: "Ollama（本機）", url: "http://127.0.0.1:11434/v1" },
  { label: "OpenAI", url: "https://api.openai.com/v1" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
];

export default function SettingsPage() {
  const { refreshStatus, status } = useStudio();
  const [s, setS] = useState<PublicSettings>();
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.settings().then(setS);
  }, []);

  const loadModels = () =>
    api.llmModels().then((r) => {
      setModels(r.models);
      setModelsError(r.error);
    });

  const endpointKey = s && `${s.llmBaseUrl}|${s.llmApiKeySet}`;
  useEffect(() => {
    if (endpointKey) void loadModels();
     
  }, [endpointKey]);

  async function save(patch: Partial<PublicSettings>) {
    const next = await api.saveSettings(patch);
    setS(next);
    setApiKey("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    void refreshStatus();
  }

  if (!s) return null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 md:p-8">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-medium">設定</h1>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-ok">
              <Check className="size-3.5" /> 已儲存
            </span>
          )}
        </div>

        <Group title="LLM" hint="任何 OpenAI 相容的 API 都能用：本機的 LM Studio、Ollama，或雲端服務。">
          <Field label="API 位址">
            <div className="flex gap-2">
              <input
                defaultValue={s.llmBaseUrl}
                key={s.llmBaseUrl}
                onBlur={(e) => e.target.value !== s.llmBaseUrl && save({ llmBaseUrl: e.target.value.trim() })}
                className={inputCls}
              />
              <Select value="" onChange={(e) => e.target.value && save({ llmBaseUrl: e.target.value })} className="w-28 shrink-0 sm:w-36">
                <option value="">常用…</option>
                {LLM_PRESETS.map((p) => (
                  <option key={p.url} value={p.url}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field label="API key" hint="本機服務通常不需要。存在伺服器上，不會傳回瀏覽器。">
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={s.llmApiKeySet ? "已設定（留空表示不變）" : "未設定"}
                className={inputCls}
              />
              <Button onClick={() => save({ llmApiKey: apiKey })} disabled={!apiKey}>
                儲存
              </Button>
            </div>
          </Field>
          <Field label="模型">
            <div className="flex gap-2">
              {models.length > 0 ? (
                <Select value={s.llmModel} onChange={(e) => save({ llmModel: e.target.value })} className="flex-1">
                  <option value="">請選擇…</option>
                  {!models.includes(s.llmModel) && s.llmModel && <option value={s.llmModel}>{s.llmModel}</option>}
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              ) : (
                <input
                  defaultValue={s.llmModel}
                  key={s.llmModel}
                  placeholder="模型名稱"
                  onBlur={(e) => e.target.value !== s.llmModel && save({ llmModel: e.target.value.trim() })}
                  className={inputCls}
                />
              )}
              <Button variant="ghost" onClick={loadModels} title="重新讀取模型清單">
                <RefreshCw className="size-4" />
              </Button>
            </div>
            {modelsError && <p className="mt-1 text-xs text-bad">讀不到模型清單：{modelsError}</p>}
          </Field>
          <Field label={`Temperature：${s.llmTemperature}`}>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.1}
              defaultValue={s.llmTemperature}
              onMouseUp={(e) => save({ llmTemperature: Number((e.target as HTMLInputElement).value) })}
              className="w-full max-w-60 accent-accent-strong"
            />
          </Field>
          <Toggle
            checked={s.llmDisableThinking}
            onChange={(v) => save({ llmDisableThinking: v })}
            label="關閉模型的「思考」階段"
            hint="寫 prompt 不需要長篇推理，本機 Qwen3.5 會快約 10 倍。想要更深入的對話時再打開。"
          />
        </Group>

        <Group title="GPU 共用" hint="16GB VRAM 放不下生圖模型和本機 LLM，讓它們輪流使用。LLM 載不進 GPU 時，會自動請閒置的 ComfyUI 釋放 VRAM 再重試。只在 LLM 位址是本機 LM Studio 時有作用。">
          <Toggle
            checked={s.unloadLlmBeforeGenerate}
            onChange={(v) => save({ unloadLlmBeforeGenerate: v })}
            label="生圖前先卸載 LM Studio 的模型"
            hint="下次呼叫 LLM 時 LM Studio 會自動重新載入（需開啟 JIT 載入）。"
          />
          <Toggle
            checked={s.freeComfyBeforeLlm}
            onChange={(v) => save({ freeComfyBeforeLlm: v })}
            label="每次呼叫 LLM 前都先請 ComfyUI 釋放 VRAM"
            hint="通常不需要：載入失敗時已經會自動釋放。"
          />
        </Group>

        <Group title="ComfyUI">
          <Field label="位址" hint={status ? (status.comfy ? "已連線" : "連不上") : undefined}>
            <input
              defaultValue={s.comfyUrl}
              key={s.comfyUrl}
              onBlur={(e) => e.target.value !== s.comfyUrl && save({ comfyUrl: e.target.value.trim() })}
              className={inputCls}
            />
          </Field>
        </Group>
      </div>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
      </div>
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="shrink-0 text-muted">{label}</span>
        {hint && <span className="text-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-accent-strong" />
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </span>
    </label>
  );
}
