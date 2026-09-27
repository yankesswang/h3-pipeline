"""Click-to-select for Comfy Studio: a tiny HTTP server around SAM 2.

Runs outside ComfyUI's queue so selections stay instant while an image is
generating. The image embedding is computed once per image and cached, so each
click only runs the light mask decoder.

POST /segment  {"image": "/abs/path.png", "points": [[x, y, 1|0], ...], "box": [x0, y0, x1, y1] | null}
  -> {"mask": "<base64 PNG, white = selected>", "score": float}
GET  /health   -> {"ok": true, "device": "cuda" | "cpu"}
"""

import base64
import io
import json
import os
import sys
import threading
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch
from PIL import Image
from transformers import Sam2Model, Sam2Processor

MODEL_ID = os.environ.get("SAM_MODEL", "facebook/sam2.1-hiera-small")  # a hub id or a local folder
CACHE_DIR = os.environ.get("SAM_CACHE_DIR")
PORT = int(os.environ.get("SAM_PORT", "8199"))


def pick_device() -> str:
    # The image model usually holds most of the GPU; SAM small needs well under 1 GB.
    if torch.cuda.is_available():
        free, _ = torch.cuda.mem_get_info()
        if free > 1.5 * 1024**3:
            return "cuda"
    return "cpu"


DEVICE = pick_device()
processor = Sam2Processor.from_pretrained(MODEL_ID, cache_dir=CACHE_DIR)
model = Sam2Model.from_pretrained(MODEL_ID, cache_dir=CACHE_DIR).to(DEVICE).eval()
lock = threading.Lock()
embeddings: "OrderedDict[str, tuple]" = OrderedDict()  # path+mtime -> (inputs, embeddings, size)


def embed(path: str):
    key = f"{path}:{os.path.getmtime(path)}"
    if key in embeddings:
        embeddings.move_to_end(key)
        return embeddings[key]
    image = Image.open(path).convert("RGB")
    inputs = processor(images=image, return_tensors="pt").to(DEVICE)
    with torch.inference_mode():
        emb = model.get_image_embeddings(inputs["pixel_values"])
    embeddings[key] = (inputs, emb, image.size)
    while len(embeddings) > 8:
        embeddings.popitem(last=False)
    return embeddings[key]


def segment(path: str, points, box):
    inputs, emb, (w, h) = embed(path)
    kwargs = {}
    if points:
        kwargs["input_points"] = [[[[p[0], p[1]] for p in points]]]
        kwargs["input_labels"] = [[[int(p[2]) for p in points]]]
    if box:
        kwargs["input_boxes"] = [[box]]
    prompt = processor(images=None, original_sizes=inputs["original_sizes"], return_tensors="pt", **kwargs).to(DEVICE)
    prompt.pop("original_sizes", None)
    with torch.inference_mode():
        out = model(image_embeddings=emb, multimask_output=len(points or []) <= 1 and not box, **prompt)
    masks = processor.post_process_masks(out.pred_masks.cpu(), inputs["original_sizes"].cpu())[0][0]  # (k, H, W)
    scores = out.iou_scores.cpu()[0, 0]
    best = int(torch.argmax(scores))
    mask = masks[best].numpy().astype(np.uint8) * 255
    buf = io.BytesIO()
    Image.fromarray(mask, "L").save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode(), float(scores[best])


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "device": DEVICE, "model": MODEL_ID})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/segment":
            return self._send(404, {"error": "not found"})
        try:
            req = json.loads(self.rfile.read(int(self.headers["content-length"])))
            with lock:
                mask, score = segment(req["image"], req.get("points") or [], req.get("box"))
            self._send(200, {"mask": mask, "score": score})
        except Exception as e:  # report, don't crash the server
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"sam ready on {PORT} ({DEVICE}, {MODEL_ID})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
