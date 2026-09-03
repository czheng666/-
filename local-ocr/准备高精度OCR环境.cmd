@echo off
setlocal
title 临床采集 - 准备高精度 OCR 环境
cd /d "%~dp0.."
if not exist "local-ocr\.venv\Scripts\python.exe" (
  echo 正在创建本机 OCR 环境...
  py -3.14 -m venv "local-ocr\.venv"
  if errorlevel 1 (
    echo 创建环境失败，请安装 Python 3.14 或联系信息科配置本机 Python。
    pause
    exit /b 1
  )
)
echo 正在安装 OCR 依赖，首次需要网络...
"local-ocr\.venv\Scripts\python.exe" -m pip install --upgrade pip
"local-ocr\.venv\Scripts\python.exe" -m pip install -r "local-ocr\requirements.txt"
if errorlevel 1 (
  echo OCR 依赖安装失败。
  pause
  exit /b 1
)
echo 正在下载并校验 PP-OCRv5 server 模型，约需数分钟...
"local-ocr\.venv\Scripts\python.exe" "local-ocr\download_models.py"
if errorlevel 1 (
  echo 模型准备失败；可在网络正常时重新双击本文件。
  pause
  exit /b 1
)
echo 本机高精度 OCR 环境准备完成。
pause
