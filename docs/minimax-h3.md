# MiniMax H3 影片生成使用說明

更新日期：2026-09-28

MiniMax H3 會從文字或圖片生成短片，**畫面和聲音一次生成**（環境音、音效、音樂、對白）。在 Comfy Studio 裡有兩個入口：

- **首頁生成面板**：切到「影片」模式。
- **影片頁（`/video`）**：一步一步的流程，也是唯一能加「中間關鍵幀」的地方。

## 模型檔案

以下都放在 ComfyUI 的 `models/` 底下。本機的 ComfyUI 在：

```
/home/phison/Documents/Codex/2026-09-27/https-huggingface-co-abenzerps-qwen-image/outputs/ComfyUI/models/
```

| 用途 | 檔案 | 資料夾 |
|---|---|---|
| 影片模型 | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `diffusion_models/` |
| 文字編碼器 | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `text_encoders/` |
| 影像 VAE | `minimax_h3_video_vae_fp16.safetensors` | `vae/` |
| 聲音 VAE | `minimax_h3_audio_vae_fp32.safetensors` | `vae/` |
| pi-H3 2 步 DWD adapter | `pi_h3_2step_dwd_adapter_int8_convrot.safetensors` | `loras/` |
| pi-H3 4 步 DWD adapter（預設） | `pi_h3_4step_dwd_adapter_int8_convrot.safetensors` | `loras/` |
| 4 步加速 LoRA | `minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors` | `loras/` |
| 8 步加速 LoRA | `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` | `loras/` |

pi-H3 adapter 來自 [Lakonik/pi-H3](https://huggingface.co/Lakonik/pi-H3)，需要 ComfyUI ≥ 0.45 和 `custom_nodes/ComfyUI-piFlow`（[Lakonik/ComfyUI-piFlow](https://github.com/Lakonik/ComfyUI-piFlow)）。

模型來源：[Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3)（8 步 LoRA 來自 [lightx2v/Minimax-h3-Turbo](https://huggingface.co/lightx2v/Minimax-h3-Turbo)）。

程式中組 workflow 的地方是 `src/lib/tools/video.ts`。

## 生成模式

| 模式 | 怎麼用 | 尺寸 |
|---|---|---|
| 文字生成影片 | 不放任何圖片，只寫 prompt | 依選的比例和畫質 |
| 圖片生成影片 | 放「第一幀」，影片從這張圖開始 | 跟著第一幀的比例 |
| 加結尾幀 | 有第一幀時，再放一張「結尾幀」，影片會往它移動、最後停在它 | 同上 |
| 中間關鍵幀 | 只在影片頁：有第一幀時，指定某秒要經過的畫面 | 同上 |
| 接續上一支 | 在影片上按「用最後一幀接續」，把它的最後一幀當作下一支的第一幀 | 同上 |

每支影片會存成 `<id>.mp4`，另外保留第一幀 `<id>.png`（縮圖）和最後一幀 `<id>.last.png`（接續用）。

## 參數說明

### 基本

| 參數 | 範圍 | 說明 |
|---|---|---|
| 長度 | 1–10 秒 | 會對齊到模型的幀數規則（24 fps、17k+5 幀），例如 3 秒 → 73 幀、5 秒 → 124 幀。模型的訓練範圍約 5–15 秒。 |
| 畫質 | 352p / 480p / 608p / 672p / 768p | 按鈕標示短邊（以 16:9 為例）；滑鼠移上去可看完整尺寸。768p（1344×768）是官方原生最高畫質。 |
| 比例 | 1:1、4:3、3:4、3:2、2:3、16:9、9:16 | 只有文字生成時可選；有第一幀時跟著圖片走。 |
| Seed | 任意整數 | 「固定 seed」可重現同樣結果；「每次隨機」每支都不同。一次生成多支時會自動用不同 seed。 |

### 進階（生成面板的滑桿圖示 / 影片頁的「設定」）

| 參數 | 預設 | 說明 |
|---|---|---|
| 加速 | pi-H3 4 步 | **pi-H3 2 / 4 步**：pi-Flow 蒸餾 + DWD，最後一步直接輸出畫面、不經 VAE 解碼，步數固定、sampler 固定 euler（不顯示 Steps / Sampler 選項）；2 秒 0.4 MP 約 15 秒，比 Turbo 4 步快約四成。**4 步**：Turbo LoRA，最快，適合試 prompt；為 768p 訓練，低解析度時細節可能較少。**8 步**：速度與品質平衡。**原始模型**：不掛 LoRA，約 20 步，最慢、細節最多。 |
| Steps | 依加速而定（4 / 8 / 20） | 切換加速時會自動改成建議值；可再微調。 |
| Sampler | `res_multistep` | 官方預設。可改其他 sampler 實驗，按「還原官方預設」回來。 |
| Scheduler | `simple` | 同上。 |

影片**沒有** CFG 和負面 prompt：官方流程使用 BasicGuider，不支援這兩項。

### 舊影片

在這些選項加入之前做的影片，重用時會照原本的方式跑：當時開 Turbo 的視為「8 步」，關 Turbo 的視為「原始模型」。

## 寫 prompt 的方法

在想法欄用任何語言描述，選「H3 影片」範本後按「擴寫」，本機 LLM 會寫成下面的格式。也可以直接用英文照這個格式寫。

1. **一段畫面描述**，40–110 個英文字：
   - 文字生成：第一句先交代誰或什麼、在哪裡，再寫動作。
   - 有第一幀：**不要再描述圖片**，直接從「先動的東西」開始寫。
   - 動作照發生順序寫，要具體、物理上合理：誰動、往哪、多快。
   - 長度決定能發生多少事：3 秒以下只做一個動作，3–6 秒最多兩個，不要塞一整個故事。
   - 一個鏡頭指令：static shot、slow push-in、pull back、pan left/right、tracking shot、orbit、handheld。
   - 幾個字交代光線和氣氛。
2. **最後一行以 `Audio:` 開頭**，一句話描述聲音：環境音、音效、音樂風格或對白。
   - 對白要把原話放在雙引號裡，並寫出誰說、用什麼語言，例如 `The man says in Mandarin: "我們走吧。"`，長度要在片長內講得完。

除非有要求，不要讓畫面出現文字、字幕或 logo。

範例（文字生成，3 秒；想法：貓咪在窗邊看雨）：

```
A fluffy orange cat sits on a wooden windowsill beside a rain-streaked window at dusk. It slowly turns its head to follow a drop sliding down the glass, then its ears twitch as thunder rumbles. Static shot, eye level, shallow depth of field. Soft blue light from outside, warm lamp glow inside, calm and cozy.
Audio: steady rain on glass, a distant low thunder roll, a soft purr.
```

範例（有第一幀：月台上的男人，5 秒；想法：他轉身離開，說再見）：

```
The man lowers his hand from his face, turns away from the camera and walks slowly toward the arriving train, his coat moving in the wind. Slow pull back as he steps through the doors. Cold morning light, quiet and bittersweet.
Audio: train brakes hissing, a platform announcement echoing; before turning, he says in Mandarin: "再見了。"
```

## 速度、VRAM 與限制

**時間**：以 8 步、480p、3 秒約 50 秒為基準，大約與「幀數 × 像素量 × 步數」成正比。介面上的「約 N 秒」就是這樣估的。

| 設定（3 秒） | 大約時間 |
|---|---|
| 4 步、480p | 約 30 秒 |
| 8 步、480p | 約 50 秒 |
| 8 步、768p | 約 2 分鐘 |
| 原始模型 20 步、768p | 約 5 分鐘 |

以上是依公式推算，4 步版本還沒有實測過。第一次生成或剛切換模型時，另外要加上載入模型的時間。

**VRAM**：

- 顯卡 16 GB 一次只放得下一個大模型：Qwen Image、MiniMax H3、LM Studio 的 LLM 三者擇一。從圖片切到影片時會先卸載其他模型，可以在「監控」頁手動切換。
- 峰值顯存主要看**解析度 × 長度**，步數只影響時間。4 步和 8 步 LoRA 大小相同，一次只掛一個，不會額外增加 VRAM。
- 在 4 步和 8 步之間切換時，第一支會多花一點時間重新套用 LoRA。

**解析度上限**：本機的 H3 原生短邊是 768（最大 1344×768），沒辦法直接生成 1080p。MiniMax 官方宣傳的「最高 2K」是雲端版本。想要 1080p，只能生成後再放大。

## 常見問題

- **生成失敗，說找不到 LoRA**：確認上面表格裡的 LoRA 檔案在 `models/loras/`，檔名要完全一樣。
- **動作太多、畫面亂**：縮短 prompt 裡的動作數量，或把影片拉長。
- **結尾沒有停在結尾幀**：prompt 要描述「怎麼變成結尾幀」，不要描述別的動作。
- **聲音不對**：`Audio:` 行寫具體一點，對白要加引號並寫出語言。
- **想要更好的品質**：先用 4 步試 prompt 和 seed，確定後固定 seed，改用 8 步或原始模型、768p 出正式版。
