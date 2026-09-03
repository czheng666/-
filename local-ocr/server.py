from __future__ import annotations

import argparse
import base64
import io
import json
import re
import sys
import threading
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
SERVICE_ROOT = Path(__file__).resolve().parent
MODEL_DIR = SERVICE_ROOT / "models"
_engine = None
_engine_lock = threading.Lock()


def json_response(handler: SimpleHTTPRequestHandler, payload: dict[str, Any], status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    origin = handler.headers.get("Origin", "")
    allowed_origin = origin if origin.startswith(("http://127.0.0.1:", "http://localhost:")) else ""
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    if allowed_origin:
        handler.send_header("Access-Control-Allow-Origin", allowed_origin)
        handler.send_header("Vary", "Origin")
    handler.end_headers()
    handler.wfile.write(body)


def decode_data_url(data_url: str):
    import numpy as np
    from PIL import Image

    if not isinstance(data_url, str) or "," not in data_url:
        raise ValueError("图片数据格式无效")
    _, encoded = data_url.split(",", 1)
    raw = base64.b64decode(encoded, validate=True)
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    return np.asarray(image)[:, :, ::-1].copy()


def load_engine():
    global _engine
    if _engine is not None:
        return _engine
    with _engine_lock:
        if _engine is not None:
            return _engine
        try:
            from rapidocr import EngineType, LangCls, LangDet, LangRec, ModelType, OCRVersion, RapidOCR
        except ImportError as error:
            raise RuntimeError("未安装本机 OCR 依赖，请先双击“准备高精度OCR环境.cmd”") from error

        det_path = MODEL_DIR / "ch_PP-OCRv5_det_server.onnx"
        rec_path = MODEL_DIR / "ch_PP-OCRv5_rec_server.onnx"
        cls_path = MODEL_DIR / "ch_PP-LCNet_x1_0_textline_ori_cls_server.onnx"
        missing = [str(path.name) for path in (det_path, rec_path, cls_path) if not path.exists()]
        if missing:
            raise RuntimeError(f"缺少本机 OCR 模型：{', '.join(missing)}，请先准备模型")

        _engine = RapidOCR(
            params={
                "Det.engine_type": EngineType.ONNXRUNTIME,
                "Det.lang_type": LangDet.CH,
                "Det.model_type": ModelType.SERVER,
                "Det.ocr_version": OCRVersion.PPOCRV5,
                "Det.model_path": str(det_path),
                "Rec.engine_type": EngineType.ONNXRUNTIME,
                "Rec.lang_type": LangRec.CH,
                "Rec.model_type": ModelType.SERVER,
                "Rec.ocr_version": OCRVersion.PPOCRV5,
                "Rec.model_path": str(rec_path),
                "Cls.engine_type": EngineType.ONNXRUNTIME,
                "Cls.lang_type": LangCls.CH,
                "Cls.model_type": ModelType.SERVER,
                "Cls.ocr_version": OCRVersion.PPOCRV5,
                "Cls.model_path": str(cls_path),
            }
        )
        return _engine


def resize_for_ocr(image):
    import cv2

    height, width = image.shape[:2]
    longest = max(height, width)
    target = min(4200, max(2400, longest))
    if longest == target:
        return image
    scale = target / max(1, longest)
    return cv2.resize(image, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=cv2.INTER_CUBIC)


def build_variants(image):
    import cv2

    base = resize_for_ocr(image)
    gray = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY)
    gray = cv2.fastNlMeansDenoising(gray, None, 3, 7, 21)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    contrast = cv2.normalize(clahe, None, 0, 255, cv2.NORM_MINMAX)
    adaptive = cv2.adaptiveThreshold(contrast, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 35, 9)
    return [
        ("拍屏增强", cv2.cvtColor(contrast, cv2.COLOR_GRAY2BGR)),
        ("拍屏自适应", cv2.cvtColor(adaptive, cv2.COLOR_GRAY2BGR)),
        ("原图缩放", base),
    ]


def result_items(result):
    def get_result_value(name: str, fallback_name: str | None = None):
        if isinstance(result, dict):
            value = result.get(name)
            if value is None and fallback_name:
                value = result.get(fallback_name)
            return value
        value = getattr(result, name, None)
        if value is None and fallback_name:
            value = getattr(result, fallback_name, None)
        return value

    boxes = get_result_value("boxes", "bboxes")
    texts = get_result_value("txts", "texts")
    scores = get_result_value("scores")
    if boxes is None:
        boxes = []
    if texts is None:
        texts = []
    if scores is None:
        scores = []
    items = []
    for index, text in enumerate(texts):
        text = str(text or "").strip()
        if not text:
            continue
        box = boxes[index] if index < len(boxes) else []
        points = []
        for point in box:
            try:
                points.append([float(point[0]), float(point[1])])
            except (IndexError, TypeError, ValueError):
                pass
        if len(points) < 4:
            continue
        try:
            score = max(0.0, min(1.0, float(scores[index]))) if index < len(scores) else 0.0
        except (TypeError, ValueError):
            score = 0.0
        items.append({"text": text, "score": score, "poly": points})
    return items


def candidate_score(items):
    text = "\n".join(item["text"] for item in items)
    compact = re.sub(r"\s+", "", text)
    chinese = len(re.findall(r"[\u4e00-\u9fff]", compact))
    digits = len(re.findall(r"\d", compact))
    latin_noise = len(re.findall(r"\b[A-Z]{6,}\b", text))
    terms = sum(term in compact for term in ("姓名", "住院号", "病案号", "手术记录", "术中诊断", "阑尾", "腹腔镜", "穿孔", "脓液", "腹膜炎", "手术步骤"))
    average = sum(item["score"] for item in items) / max(1, len(items))
    return (chinese / 80) + min(1.0, digits / 20) + terms * 0.55 + average - latin_noise * 1.2 + min(1.2, len(items) / 80)


def sort_items(items):
    return sorted(items, key=lambda item: (min(point[1] for point in item["poly"]), min(point[0] for point in item["poly"])))


def recognize_page(image):
    engine = load_engine()
    candidates = []
    for label, variant in build_variants(image):
        result = engine(variant)
        items = sort_items(result_items(result))
        candidates.append((candidate_score(items), label, items))
    _, selected_label, selected_items = max(candidates, key=lambda candidate: candidate[0], default=(0, "", []))
    return selected_label, selected_items


def blocks_to_text(items):
    lines = []
    for item in items:
        text = item["text"]
        if text:
            lines.append(text)
    return "\n".join(lines)


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def do_OPTIONS(self):
        if self.path.startswith("/api/"):
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_GET(self):
        if self.path == "/api/health":
            ready = all((MODEL_DIR / name).exists() for name in ("ch_PP-OCRv5_det_server.onnx", "ch_PP-OCRv5_rec_server.onnx", "ch_PP-LCNet_x1_0_textline_ori_cls_server.onnx"))
            json_response(self, {"ok": True, "ready": ready, "engine": "RapidOCR + PP-OCRv5 server", "dataBoundary": "localhost-only"})
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/api/ocr":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 260 * 1024 * 1024:
                raise ValueError("请求图片总大小超过260MB或为空")
            body = self.rfile.read(content_length)
            payload = json.loads(body.decode("utf-8"))
            images = payload.get("images") or []
            if not images or len(images) > 30:
                raise ValueError("一次最多识别30张图片")
            pages = []
            combined = []
            for page_index, image in enumerate(images):
                label, items = recognize_page(decode_data_url(image.get("dataUrl", "")))
                page_blocks = [{**item, "page": page_index, "variant": label} for item in items]
                page_text = blocks_to_text(items)
                pages.append({"page": page_index, "text": page_text, "blocks": page_blocks, "variant": label})
                combined.append(f"【第 {page_index + 1} 张图片】\n{page_text}")
            json_response(self, {"ok": True, "engine": "RapidOCR + PP-OCRv5 server", "text": "\n\n".join(combined), "pages": pages, "blocks": [block for page in pages for block in page["blocks"]]})
        except Exception as error:
            json_response(self, {"ok": False, "error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def main() -> None:
    parser = argparse.ArgumentParser(description="临床采集本机高精度 OCR 服务")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), lambda *handler_args: Handler(*handler_args, directory=str(ROOT)))
    url = f"http://127.0.0.1:{args.port}/index.html"
    print(f"本机高精度 OCR 已启动：{url}")
    print("图片只在本机处理；按 Ctrl+C 停止服务。")
    if args.open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
