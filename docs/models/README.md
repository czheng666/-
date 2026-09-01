# PP-OCRv6 small 本地模型

本目录包含 PaddleOCR.js 所需的 PP-OCRv6 small 中文检测和识别 ONNX tar 模型。应用从当前站点的 `./models/` 读取，不依赖百度 BCE 资源地址。

来源：PaddleOCR ONNX 模型的 Hugging Face 镜像，归档内容保持 PaddleOCR.js 要求的非压缩 ustar tar 格式：

- `PP-OCRv6_small_det_onnx_infer.tar`
  - SHA-256: `94762840CDCBA9E0012B45288AF76D1C13F8A4AD7CA3C4CB2AFEB4F26903E0DA`
- `PP-OCRv6_small_rec_onnx_infer.tar`
  - SHA-256: `C0A416130471ED8873E70B64368504E1832050D3EF1728FCE7303C9F05D047A8`

PP-OCRv5 旧模型文件仍保留在本目录作为备份，但应用默认不会加载。ONNX Runtime Web 的 WASM 文件、PaddleOCR.js SDK 及其依赖已放入 `../vendor/`，核心 PaddleOCR 初始化和推理不依赖外部地址。
