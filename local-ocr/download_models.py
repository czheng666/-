from __future__ import annotations

import hashlib
import os
import sys
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models"

MODELS = {
    "ch_PP-OCRv5_det_server.onnx": {
        "url": "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_server.onnx",
        "sha256": "0f8846b1d4bba223a2a2f9d9b44022fbc22cc019051a602b41a7fda9667e4cad",
    },
    "ch_PP-OCRv5_rec_server.onnx": {
        "url": "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_server.onnx",
        "sha256": "e09385400eaaaef34ceff54aeb7c4f0f1fe014c27fa8b9905d4709b65746562a",
    },
    "ch_PP-LCNet_x1_0_textline_ori_cls_server.onnx": {
        "url": "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/cls/ch_PP-LCNet_x1_0_textline_ori_cls_server.onnx",
        "sha256": "7d3c02ef6c7da8ae08b4347cc7695b2081aae68c325d64375724ecf39c99e743",
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_one(name: str, info: dict[str, str]) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    target = MODEL_DIR / name
    if target.exists() and sha256(target) == info["sha256"]:
        print(f"已存在：{name}")
        return
    temp = target.with_suffix(target.suffix + ".download")
    print(f"下载模型：{name}")
    try:
        urllib.request.urlretrieve(info["url"], temp)
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    actual = sha256(temp)
    if actual != info["sha256"]:
        temp.unlink(missing_ok=True)
        raise RuntimeError(f"模型校验失败：{name}，期望 {info['sha256']}，实际 {actual}")
    os.replace(temp, target)
    print(f"校验通过：{name}")


if __name__ == "__main__":
    try:
        for model_name, model_info in MODELS.items():
            download_one(model_name, model_info)
    except Exception as error:
        print(f"模型准备失败：{error}", file=sys.stderr)
        sys.exit(1)
    print(f"模型已准备到：{MODEL_DIR}")
