# 素材與資料來源

- 聲線描述與結構化特徵：官方 [BreezeBlue/TTS-Voice-Design-Benchmark](https://huggingface.co/datasets/BreezeBlue/TTS-Voice-Design-Benchmark)，revision `a1c8cf3487620b2f71d6d8db3e584639e2fc3680`。
- 繁中描述：沿用原 TTS 專案已完成的 Qwen3 翻譯，不另行編造聲線。Qwen3-14B 979 筆、Qwen3-8B 21 筆。
- WAV：沿用專案持有者先前以 Breeze TTS 生成的 1,000 個檔案，按位元組複製，沒有重新生成、轉碼或修改。`metadata/audio-manifest.json` 保存原檔 SHA256。
- 中文字型：[LXGW WenKai TC](https://github.com/google/fonts/tree/main/ofl/lxgwwenkaitc)，Regular 的 WOFF2 字形子集（衍生字型名稱 Breeze Notes Hand；細節見 scripts/FONT_NOTES.md）；英文標題：[Kalam](https://github.com/google/fonts/tree/main/ofl/kalam)，Bold。均採 SIL Open Font License；完整授權位於 `assets/fonts/*-OFL.txt`。字型在同一 Repo 內供應，不請求 Google Fonts。
- 錄音帶、聲波與圖示：本專案 SVG / CSS 繪製，無外部圖片服務。

本專案不代表 Breeze 官方網站；來源資料、模型、字型及音訊各自適用的權利不因網站公開而轉移。本檔沒有替未明示授權的素材增設授權條款。
