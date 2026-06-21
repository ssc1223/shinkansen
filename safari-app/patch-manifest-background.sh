#!/usr/bin/env bash
# patch-manifest-background.sh — Safari build 的 manifest background 改宣告 event page
# （safari-build.sh 與 safari-build-ios.sh 共用，單一資料源、不雙實作）
#
# 為什麼存在（2026-06-07）：
#   iOS Safari 的 MV3 background **service worker 被系統回收後不再喚醒**
#   （Apple Developer Forums thread 758346；iOS 17.4 起、迄今未修）。SW 死後
#   content script / popup 的 runtime 訊息石沉大海且叫不醒它——「用一段時間後
#   四指 / popup 失效，強制關閉 Safari 才復原」的根因。Safari 對 background
#   event page（scripts + persistent: false）的生命週期管理正常：卸載後下一個
#   事件會重新喚起；WebKit 原始碼（WebExtension.cpp generatedBackgroundContent）
#   證實 scripts 形式照樣吃 type: "module"（產生 <script type="module">），
#   background.js 的 16 個 static import 不需 bundle。
#
#   Chrome 版 manifest（shinkansen/）維持 service_worker 不動——Safari build
#   的受控差異由本 script 產生並驗證。
#
# 用法：patch-manifest-background.sh <manifest.json 路徑>
#   就地改寫（冪等）：background = { scripts: [<原 service_worker>],
#   type: <原 type，預設 classic 不寫>, persistent: false }
set -euo pipefail

MANIFEST="${1:?用法: patch-manifest-background.sh <manifest.json 路徑>}"
if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: $MANIFEST 不存在" >&2
  exit 1
fi

# 用 Node 取代 jq：Windows 開發環境通常已有 Node（本 repo 測試也依賴 Node），
# 但不一定有 jq。保持輸入輸出與 jq 版本相同：就地改寫、冪等、保留 background.type。
node --input-type=module - "$MANIFEST" <<'NODE'
import fs from 'node:fs';

const manifestPath = process.argv[2];
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (err) {
  console.error(`ERROR: ${manifestPath} 不是有效 JSON: ${err.message}`);
  process.exit(1);
}

const bg = manifest.background || {};
const already = Array.isArray(bg.scripts) && !Object.prototype.hasOwnProperty.call(bg, 'service_worker');
if (!already) {
  const swFile = bg.service_worker;
  if (!swFile || swFile === 'null') {
    console.error(`ERROR: ${manifestPath} 讀不到 background.service_worker`);
    process.exit(1);
  }
  delete bg.service_worker;
  bg.scripts = [swFile];
  bg.persistent = false;
  manifest.background = bg;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const patchedBg = manifest.background || {};
const ok = Array.isArray(patchedBg.scripts)
  && patchedBg.scripts.length === 1
  && patchedBg.persistent === false
  && !Object.prototype.hasOwnProperty.call(patchedBg, 'service_worker');
if (!ok) {
  console.error('ERROR: manifest background 不是預期 event page 形式：');
  console.error(JSON.stringify(patchedBg, null, 2));
  process.exit(1);
}

console.log(`manifest background patched: ${JSON.stringify(patchedBg)}`);
NODE
