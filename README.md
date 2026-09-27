# Comfy Studio

A friendlier front end for ComfyUI: no node graph, an LLM that writes image
prompts with your own system prompts, and a gallery that remembers how every
image was made.

## Run

Needs ComfyUI running (default `http://127.0.0.1:8188`) with the Qwen Image 2.1
GGUF models, and optionally an OpenAI-compatible LLM (LM Studio by default).

```bash
./studio.sh        # production build, http://localhost:3100
./studio.sh dev    # dev server with hot reload
```

Node 22 is expected at `~/.local/opt/node22` (the system Node is too old).
Data (SQLite + PNGs) lives in `./data`.

## Layout

- `src/lib/tools/` — a *tool* is a ComfyUI API-format workflow plus a map from
  friendly field names to node inputs. Built-in generation uses this; imported
  workflows will too.
- `src/lib/server/` — ComfyUI client (HTTP + websocket), the one-at-a-time job
  queue, the LLM proxy, SQLite storage, and GPU sharing between ComfyUI and LM Studio.
- `src/app/api/` — route handlers. `/api/events` streams job progress (SSE).
- `src/app/` pages — studio (`/`), gallery, prompt library, settings.

## GPU sharing

16 GB of VRAM does not hold the image model and a local LLM at once. Before a
generation the app runs `lms unload --all`; when LM Studio fails to load a model
and nothing is generating, it asks ComfyUI to free VRAM (`/free`) and retries.

## Roadmap

1. **M1 (done)** text-to-image, LLM expand + chat, system prompt library, gallery
2. **M2** instruction editing with Qwen Image 2.1 (multi-reference), version tree
3. **M3** canvas: mask brush, SAM click-select, outpaint
4. **M4** workflow import + field mapping editor, LoRA management
