# Breeze TTS Voice Library

**一個 Repo，完整網站 + 1,000 個原始 WAV。** 純 HTML、CSS、JavaScript，透過 GitHub Pages 發布。訪客不需要 Python、Node.js、ComfyUI、AI 模型、API Key 或任何後端。

## 現在已有什麼

手繪紙張風格、繁中介面、關鍵字搜尋、性別／音高／類型篩選、四種排序、每頁 12 筆、隨機試聽、完整聲線描述、單一音訊播放器、進度／時間／音量、WAV 下載，以及最多四個聲音的比較清單。比較選擇只存在訪客自己的瀏覽器；不蒐集帳號或個人資料。

音檔保留實際原名 `tts-design-0001.wav` 至 `tts-design-1000.wav`。索引工具掃描實際檔案，不靠連號猜測路徑；也支援空格、中文及其他非連號檔名。沒有使用 Git LFS、Base64、第二個 Repo 或外部音訊主機。音檔只在按播放／下載時請求。

## 最快部署：只建立一個空白 Repo

1. 在 GitHub 建立一個 **Public** 空白 Repository，例如 `breeze-tts-voice-library`。不要勾選初始化 README、License 或 `.gitignore`，避免與完整專案衝突。
2. 開啟 GitHub Desktop，選 **File → Add local repository**，選擇本 `repo` 資料夾。建立第一個 commit 後，選 **Repository → Repository settings → Remote**，填入剛建立的空白 Repo HTTPS URL，然後 Push。請使用這個既有空白 Repo，不要再用「Publish repository」另建第二個。
3. GitHub 網站進入同一 Repo 的 **Settings → Pages → Build and deployment → Source → GitHub Actions**。若首次 push 的部署因尚未啟用 Pages 而失敗，設定後到 **Actions → Deploy voice library to GitHub Pages → Run workflow → main → Run workflow** 重跑。
4. 在 **Actions** 等待 `build`、`deploy` 都變成綠勾。部署上傳約 537 MiB 靜態內容；時間取決於 GitHub 網路與排程。請勿在執行中反覆重跑。
5. 開啟 **Settings → Pages → Visit site**，或 Actions 的 `github-pages` environment 網址。正式網站不依賴你的電腦運行。

若 GitHub Desktop 不提供直接設定 Remote 的欄位，使用下方 Git 指令；**不要**為解決介面問題建立另一個 Repo。GitHub Desktop 可處理首次 Git 身分與登入；網站訪客不需要安裝它。

### 使用 Git 上傳（GitHub Desktop 的替代方法）

在本專案資料夾開啟 PowerShell。下列 `你的帳號` 與 `Repo名稱` 必須替換成你剛建立的那一個空白 Repo：

```powershell
git init -b main
git add .
git commit -m "Add Breeze TTS voice library and 1000 original WAVs"
git remote add origin https://github.com/你的帳號/Repo名稱.git
git push -u origin main
```

本交付資料夾若已顯示 `main` 分支，可省略 `git init`；若已有 `origin`，先用 `git remote -v` 確認是同一 Repo，再執行 push。Git 要求身分時，在本 Repo 設定自己的 `user.name` / `user.email`，不要將 Token 寫進檔案、指令或 Remote URL。依 GitHub 正常登入流程認證。

**上傳的是本資料夾裡的內容**：`index.html` 必須位於 Repo 根目錄，不能再包一層 `repo/`。不要把原 TTS 的 `.venv`、`models`、快取、`user/`、執行日誌或資料庫拖進來。

## 網址如何組成

一般專案：`https://你的帳號.github.io/Repo名稱/`。

若唯一 Repo 恰好命名為 `你的帳號.github.io`，網址為 `https://你的帳號.github.io/`。本網站全部使用相對路徑，兩種形式都適用；不必修改 JS、音檔路徑或設定 base URL。不含前置 `/output/` 或 `/assets/` 根路徑。

## 檔案結構

```text
index.html                    網站首頁
assets/css/style.css          手繪設計系統、響應式樣式
assets/js/app.js              搜尋、篩選、分頁、試聽與比較
assets/fonts/                 本地字型與授權
assets/images/favicon.svg     圖示
output/*.wav                  1,000 個原始音檔
data/voices.json              已產生、可直接發布的完整索引
metadata/voices-source.json   原有繁中／英文描述及聲線特徵
metadata/audio-manifest.json  原音檔 SHA256 與大小
metadata/provenance.json      不含本機路徑的來源資訊
scripts/generate_voice_index.py  索引產生／驗證工具
scripts/build_site.py          只打包公開網站必要檔案
tests/test_index.py            索引完整性與異常情況測試
.github/workflows/deploy-pages.yml  GitHub Pages 部署
VERIFICATION.md               實際本機驗收結果與尚未驗證事項
```

原 TTS 生成程式與全部執行紀錄保留在原 TTS 資料夾；本 Repo 只複製 WAV 與去除本機資訊的聲線中繼資料。部署不執行 TTS、不安裝任何翻譯或語音模型。

## 日後更新索引

目前 JSON 已完整提交，**首次上傳不必安裝 Python 或重建**。只有變更音檔／描述時，維護者才需要 Python 3.10 以上；工具僅用標準函式庫，無套件安裝需求：

```powershell
python scripts/generate_voice_index.py
python scripts/generate_voice_index.py --check
python -m unittest discover -s tests -v
```

每筆含 `id`、`filename`、URL 編碼的相對 `audio`、繁中 `description`、原文、`voice_profile`、秒數、取樣率、大小與 SHA256。中繼資料缺失時提供合理文字與空特徵；前端不因單筆缺失崩潰。新增檔案時請同步維護來源資料及原始檔案 manifest；預設驗收數為 1,000。既有 manifest 不符會明確失敗，不會默默重寫或轉碼音檔。

Actions 每次檢查實際 WAV 數量、RIFF/WAV 格式、24 kHz、長度、原始 SHA256、每筆路徑與已提交索引一致，再執行測試。只有 `index.html`、`assets/`、`data/`、`output/`、`.nojekyll`、素材出處被複製至 `_site` 上傳；沒有模型、開發環境或機密資料。`_site/` 不應提交。

`python scripts/build_site.py` 可在本機驗證相同打包流程。此工具要求全新／空的 `_site`，避免舊檔混入；再次建置前可把先前 `_site` 改名移走，工具不會遞迴刪除資料。

### 選用：本機預覽

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

開啟 `http://127.0.0.1:8080/`。這僅是維護時的選用預覽，GitHub Pages 上線後不需要它。雙擊 `index.html` 的 `file://` 模式可能被瀏覽器擋下 JSON fetch，請使用 HTTP 或正式 Pages 網址。

## GitHub 限制與故障排除

目前 WAV 合計 **560,581,760 bytes（534.61 MiB）**；最大音檔 **1,651,280 bytes（1.57 MiB）**，沒有超過一般 Git 的 100 MiB 單檔限制。包含本地字型後，完整發布內容仍低於 1 GB。實際建置大小見 `VERIFICATION.md`。

GitHub 官方：[單檔限制](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)、[Pages 限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)、[自訂 Actions 部署](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。查核日期：2026-10-15。Pages 發布上限 1 GB、每月軟性流量限制 100 GB，部署逾 10 分鐘可能超時。這套流程沒有 Git LFS，也不把 Pages artifact 的較大容許值誤當網站大小上限。

瀏覽器直接上傳有單檔 25 MiB 與每批檔案數限制，且容易漏掉隱藏的 `.github`，**建議 GitHub Desktop 或 Git 一次上傳完整專案**，不要把約 537 MiB 的專案 ZIP 當成網站上傳。音檔重複改版會累積 Git 歷史大小；本流程不會每次部署重新產生音檔。

若部署失敗：先確認 Pages Source 已選 GitHub Actions，分支為 `main`、Repo 公開，並在 Actions 打開第一個紅色步驟看具體錯誤。組織若限制 Actions 或 environment，需要 Repo 管理員啟用。音訊 404 時前端會顯示錯誤並提供重試，其他聲音仍可使用；不要用重新生成或修改 WAV 解決路徑問題。

## 必須由你完成的操作

建立自己的空白 GitHub Repo、登入上傳、設定 Pages Source，以及等候 GitHub 真實部署完成。本交付沒有你的 Repo URL，也沒有替你建立或推送 GitHub Repo；本機預覽和打包成功**不代表公開網址已上線**。完整的實測範圍見 `VERIFICATION.md`。
