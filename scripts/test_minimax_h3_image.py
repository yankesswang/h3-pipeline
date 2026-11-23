#!/usr/bin/env python3
"""MiniMax-H3-Image smoke test through the local ComfyUI API (http://127.0.0.1:8188).

Follows the official image_minimax_h3_image_t2i template without the prompt expander:
int8 DiT, the nvfp4 Qwen3-VL 32B text encoder already used for H3 video, fp16 VAE,
6 steps, CFG 1, euler / simple, empty negative.

  python3 scripts/test_minimax_h3_image.py                      # 2048x2048 (4 MP)
  python3 scripts/test_minimax_h3_image.py --size 1024x1024 --seed 7
  python3 scripts/test_minimax_h3_image.py --prompt "..." --size 2048x1152
"""
import argparse
import json
import time
import urllib.request
import uuid
from pathlib import Path

COMFY = "http://127.0.0.1:8188"
OUTPUT = Path("/home/phison/Documents/Codex/2026-09-27/https-huggingface-co-abenzerps-qwen-image/outputs/ComfyUI/output")
DEFAULT_PROMPT = (
    "A cheerful toy-packaging poster of a handmade plush fox floating above a summer meadow, "
    "warm saturated palette, clear sky blue deepening toward the top, soft felt texture with visible "
    "stitching, bold rounded title text \"FOXY\" across the top, studio product lighting, crisp detail."
)


def call(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(COMFY + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def workflow(prompt, w, h, seed):
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "minimax_h3_image_pruned_int8_convrot.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "type": "minimax", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "minimax_h3_image_vae_fp16.safetensors"}},
        "5": {"class_type": "MiniMaxH3ImageConditioning", "inputs": {"clip": ["2", 0], "vae": ["3", 0], "prompt": prompt, "width": w, "height": h}},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["5", 1],
            "seed": seed, "steps": 6, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "h3_image_test"}},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", default=DEFAULT_PROMPT)
    ap.add_argument("--size", default="2048x2048", help="WxH, multiples of 32 (the model is tuned for ~4 MP and up)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--keep-loaded", action="store_true", help="do not ask ComfyUI to unload other models first")
    a = ap.parse_args()
    w, h = (int(v) for v in a.size.lower().split("x"))

    stats = call("/system_stats")
    print("ComfyUI", stats["system"].get("comfyui_version"), "|", stats["devices"][0]["name"])
    if not a.keep_loaded:
        call("/free", {"unload_models": True, "free_memory": True})
        time.sleep(2)

    client = str(uuid.uuid4())
    t0 = time.time()
    pid = call("/prompt", {"prompt": workflow(a.prompt, w, h, a.seed), "client_id": client})["prompt_id"]
    print(f"queued {pid}  {w}x{h}  seed {a.seed}")

    while True:
        time.sleep(2)
        hist = call(f"/history/{pid}").get(pid)
        if not hist:
            print(f"\r  running… {time.time() - t0:6.0f}s", end="", flush=True)
            continue
        print()
        status = hist.get("status", {})
        if status.get("status_str") == "error":
            for kind, msg in status.get("messages", []):
                if kind == "execution_error":
                    print("ERROR:", msg.get("node_type"), msg.get("exception_message"))
            raise SystemExit(1)
        imgs = hist["outputs"]["9"]["images"]
        print(f"done in {time.time() - t0:.1f}s")
        for im in imgs:
            print("  file:", OUTPUT / im.get("subfolder", "") / im["filename"])
            print("  view:", f"{COMFY}/view?filename={im['filename']}&subfolder={im.get('subfolder', '')}&type=output")
        break


if __name__ == "__main__":
    main()
