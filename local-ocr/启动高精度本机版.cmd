@echo off
setlocal
title 临床采集 - 本机高精度 OCR
cd /d "%~dp0.."
if not exist "local-ocr\.venv\Scripts\python.exe" (
  echo 尚未准备本机 OCR 环境，请先双击：local-ocr\准备高精度OCR环境.cmd
  pause
  exit /b 1
)
if not exist "local-ocr\models\ch_PP-OCRv5_det_server.onnx" (
  echo 尚未准备 OCR 模型，请先双击：local-ocr\准备高精度OCR环境.cmd
  pause
  exit /b 1
)
"local-ocr\.venv\Scripts\python.exe" "local-ocr\server.py" --port 8765 --open-browser
if errorlevel 1 (
  echo 本机 OCR 服务启动失败，请保留此窗口中的错误信息并联系维护人员。
  pause
)
