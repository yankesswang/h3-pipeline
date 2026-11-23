# Comfy Studio

A friendlier front end for ComfyUI: no node graph, an LLM that writes image
and video prompts with your own system prompts, intuitive editing (instructions,
brush or click-to-select regions, outpainting), videos with sound from text or
from any image, a version tree for everything, and any ComfyUI workflow turned
into a simple form.

## Run

Needs ComfyUI running (default `http://127.0.0.1:8188`) with the Qwen Image 2.1
GGUF models, and optionally an OpenAI-compatible LLM (LM Studio by default).

```bash
./studio.sh        # production build, http://localhost:3100
./studio.sh dev    # dev server with hot reload
```

Node 22 is expected at `~/.local/opt/node22` (the system Node is too old).
Data (SQLite, PNGs, masks, the SAM model) lives in `./data`.

## What's where

| Page | For |
| --- | --- |
| 創作 `/` | Generate, edit, select regions, outpaint, chat with the prompt assistant |
| 圖庫 `/gallery` | Every image with how it was made; reuse or edit any of them |
| 批次 `/batch` | One edit instruction applied to every image in a folder or a gallery selection |
| 工具 `/tools` | Imported ComfyUI workflows as forms |
| LoRA `/loras` | LoRAs ComfyUI can see, with trigger-word notes and default strengths |
| Prompt 庫 `/presets` | System prompts for generating, edit instructions and video |
| 監控 `/monitor` | Live VRAM / RAM / GPU / CPU, per process, last 5 minutes, and buttons to free memory |
| 設定 `/settings` | LLM endpoint and model, GPU sharing, ComfyUI address |

## Code layout

- `src/lib/tools/` — a *tool* is a ComfyUI API-format workflow plus a map from
  field names to node inputs. The built-in Qwen tools and imported workflows
  share this shape; tools can also take reference images and a LoRA chain.
- `src/lib/server/` — ComfyUI client (HTTP + websocket), the one-at-a-time job
  queue, the LLM proxy, SQLite storage, region editing (`regions.ts`), the SAM
  side server manager (`sam.ts`), imported tools (`tools.ts`), LoRAs.
- `src/app/api/` — route handlers. `/api/events` streams job progress (SSE).
- `sam/sam_server.py` — click-to-select with SAM 2.1, run with ComfyUI's Python.

## Editing

"Edit this" (or `E`) puts an image in the composer as `<image1>`; references
become `<image2>`… and clicking a thumbnail inserts its tag. Drop or paste
images to upload them (capped at 4 MP). Every edit records its parent, so each
image has a version tree; a single edit's result becomes the next edit target.

Qwen Image 2.1 has no mask input, so regions are handled around it:

- **Brush / click-to-select**: the selection is cropped with context, edited at
  about 1 MP, and pasted back with a feathered edge. Everything outside the
  selection keeps its original pixels.
- **Outpaint**: the image goes on a larger gray canvas (gray works much better
  than blurred or mirrored edges), the model fills it, and the original is laid
  back over the middle.

Click-to-select runs SAM 2.1 (small) in its own Python process, outside
ComfyUI's queue, so it answers in ~50 ms even while an image is generating.
The model (~180 MB) downloads on first use.

## Video

The composer's 圖片 / 影片 switch makes MiniMax H3 videos (with audio) instead
of images. With no first frame it is text to video at the chosen aspect; with
one ("做成影片" on any image) the video starts from it and keeps its shape; an
optional end frame makes it move towards a second image. "用最後一幀接續" turns
a video's last frame into an image and starts the next clip from it.

The workflow is built in `src/lib/tools/video.ts`, mirroring
`make-minimax-h3-workflow.py` (int8 model, 8-step Turbo LoRA, 24 fps, frames on
the 17k+5 grid) but choosing the mode in code instead of with switches. Two
extra SaveImage nodes keep the first and last frames, so posters and
continuation need no video decoding. Videos are stored as `<id>.mp4` with
`<id>.png` (first frame) and `<id>.last.png`. About 50 s for 2–3 s at 0.4 MP.

## Batch edit

批次 does what ComfyUI's *Qwen Image 2.1 batch edit* workflow does (its
`LoadImagesFromPath` node): pick a folder on this machine (`~` works) and every
PNG / JPG / WEBP in it, in file name order, gets the same instruction. Gallery
images and multi-file uploads work too. Each image is imported into the gallery
and becomes its own `qwen21-edit` job (`src/lib/server/batch.ts`), so results
join the version tree, show progress one by one, and can be cancelled as a
batch. The whole batch shares one seed; size defaults to the workflow's 1 MP
budget (`resolution: 1024`), or keeps each image's own size. Results can also be
written to a folder as `<original name>.png` (default `<folder>/edited`), never
overwriting existing files. Up to 200 images per batch.

## Imported workflows

Export a workflow from ComfyUI with *Export (API)*, paste it on 工具 → 匯入,
tick the inputs to expose, and save. Prompt fields get LLM expansion, seeds can
randomize, LoadImage inputs pick from the gallery. Name a node `[UI] 名稱` in
ComfyUI to have it ticked and labelled automatically.

## Monitor

`src/lib/server/monitor.ts` samples every 2 s while the page is open (and for
10 minutes after): `nvidia-smi` for the GPU and per-process VRAM, `/proc` for
RAM, swap, CPU and per-process RSS, plus ComfyUI's queue and LM Studio's loaded
models. Processes are grouped by command line into ComfyUI, LM Studio, SAM,
Comfy Studio and other. The page streams samples over SSE (`/api/monitor/stream`).
Series colors were checked with the dataviz palette validator on the app's dark
panel; status (good / high / nearly full) always pairs an icon with a label.

## GPU sharing

16 GB of VRAM does not hold the image model and a local LLM at once. Before a
generation the app runs `lms unload --all`; when LM Studio fails to load a model
and nothing is generating, it asks ComfyUI to free VRAM (`/free`) and retries.
LLM calls send `reasoning_effort: "none"` by default (≈10× faster on Qwen 3.5).

## Milestones

1. **M1** text-to-image, LLM expand + chat, system prompt library, gallery
2. **M2** instruction editing (up to 9 references), uploads, version tree
3. **M3** selection canvas: brush, SAM click-select, local edits, outpaint
4. **M4** workflow import with a field-mapping editor, LoRA library and stacking
5. **Video** MiniMax H3 text/image to video with sound, clip continuation
