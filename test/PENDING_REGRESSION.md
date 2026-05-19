# Pending Regression Tests

> **這是什麼**：待補的 regression test 清單。每筆代表「bug 已修但對應的
> regression spec 還沒寫」(對應 CLAUDE.md 硬規則 9 的路徑 B fallback)。
>
> **誰會讀**：
>   - **Claude Code** 每次新對話會檢查本檔,若非空必須在第一句話提醒 Jimmy
>     (CLAUDE.md「開始新對話時的標準動作」第 4 步);跑完 `npm test` 全綠後若本檔非空,也必須主動提醒
>   - **Jimmy** 看到提醒後可以決定要立刻清,還是先繼續手上的事
>
> **怎麼清**：見 `測試流程說明.md` 的「指令 G:清 pending regression queue」。
>
> **空 queue 的判斷**：本檔只剩本段 header + 「(目前沒有 pending 條目)」
> 那行 placeholder = 空。任何在「## 條目」section 之下的內容都算待清。

---

## 條目

### B4: Finding 3 — X 串尾 sy=10465 tweet 「I love your works ❤」 一致 100% stall(v1.9.27 留下輪解)

**症狀**(SPEC-PRIVATE §25.20.1 Finding 3 + §25.20.9):
5-run 真實 X 推文(`https://x.com/aimikoda/status/2055969783951093986`)實測,每次 user 滑到 sy≈10465 viewport 停 3s,該 viewport 內**永遠有 1 個 tweet 沒翻譯完**(specifically「I love your works ❤」短文+1 emoji)。`stall_pct=100%, first_clear_ms=null` 跨 5/5 runs 一致重現。

實際該 tweet 最終會翻譯(整頁 coverage 仍 95%),只是**不在 user 停 3s window 內**。

**Root cause 推斷**:
- SPA observer 第一輪 collectParagraphs 在該 tweet mount 後 race miss(可能因短 emoji 文字 / DOM 時序 / first-pass filter 邊角)
- 後續更晚 mutation 觸發 rescan 補抓 → 翻譯完成時 user 已滑過 3s window
- 不論 maxWait 多短,**第一輪 detect 漏了就救不回**

**兩次嘗試都失敗**(都已 revert):
1. v1.9.27 Phase 5 第一版:debounce 1000→250 / maxWait 2000→500 → 連續 mutation 各觸發迷你 batch,toast「翻譯新內容 1/1 18 秒」18s 體感比原 stall 更糟(§25.20.5)
2. v1.9.27 Phase 5 第二版:debounce 1000 不動 / maxWait 2000→500 → over-fire 沒發生但 stall 仍 100% × 2/2 runs,完全無效(§25.20.9)

**正解方向**(預估 200-400 行 code,**不是小 patch**):
- 用 IntersectionObserver `rootMargin: '1000px'` 主動觀察 `[data-testid="tweetText"]:not([data-shinkansen-translated])` 等 per-site selector
- 元素一 mount 進 DOM 立即 IO callback → 直接 enqueue 翻譯 + scope-limit rescan
- **跳過 MutationObserver debounce 整鏈 timing race**,從根本不依賴 detect-then-rescan 設計
- 架構保留:`SK.SPA_OBSERVER_FAST_DEBOUNCE_MS / FAST_MAX_WAIT_MS / FAST_HOSTS / getObserverTiming` 常數 + function 都還在(v1.9.27 留下),`SPA_OBSERVER_FAST_HOSTS = []` 暫空,3 spec 仍 pass

**為什麼進 PENDING(路徑 B)**:
- 屬「結構性新 detect 路徑」非「bug fix」— 工程量超出 v1.9.27 patch 範圍
- 對應 regression spec 需要設計 mock IO 行為 + 真實 X 端 e2e 驗,跟 maxWait timing 改動的單元 spec 不同層級
- v1.9.27 留以下三條 spec 鎖住現有架構不退化:
  - `test/regression/spa-observer-fast-host.spec.js`(3 條,getObserverTiming 預設 default,白箱注入 fast 對映正確)
  - `test/regression/spa-rescan-tiny-silent.spec.js`(4 條,tiny rescan silent + 守門)

**SANITY 驗收計畫**(下輪修完):
1. 重跑 5-run X 推文(同 URL),sy=10000 桶 stall_pct 從 100% 降到 ≤ 50%(或 < 100% 都算成功)
2. `first_clear_ms` 從 null 變成 < 3000ms(在 dwell window 內成功補上)
3. 其他 sy 桶 stall_pct 不退化(別救一頭炸另一頭)
4. rescan/api 數量不爆(避免回到 §25.20.5 over-fire)
5. 體感:user 滑動沒看到「翻譯新內容 1/1 18 秒」toast spam(tiny silent + 800ms delay 已修,須維持)

### B3: macOS Safari update-check 半鍵更新 + MAS distribution gate

兩部分綁一起,因為都跟 `safari-web-extension://` 通路的 update-check 行為相關。

~~**Part 1:popup banner Safari 分支改直連 .pkg 下載 URL(路徑 A 半鍵更新)**~~ — ✅ **SANITY 驗收完成(2026-05-18)**

~~- **改動**:`popup/popup.js` update banner click handler 加 Safari 分支——`browser.runtime.getURL('')` startsWith `safari-web-extension://` 時 URL 從「release tag page」改為「直連 GitHub Release .pkg 下載 URL」(`releases/download/v${version}/shinkansen-macos-v${version}.pkg`)。Chrome / Firefox 維持原本三層 fallback 開 release page。~~
~~- **動機**:macOS Safari 使用者沒有 CWS 自動更新,看到 banner 後原流程是「點 banner → 開 release page → 找 pkg asset → 下載」四步,改成「點 banner → 觸發瀏覽器下載 → 雙擊 pkg 重裝」省兩步。~~
~~- **SANITY 驗收結果(2026-05-18 macOS Safari 26 真機 + v1.9.25 Developer ID `.pkg`)**:構造 `updateAvailable: {version: '1.10.0'}` 假 storage → popup banner 顯示「📦 有新版可下載 v1.10.0」✅ / 點 banner 新分頁 URL = `https://github.com/jimmysu0309/shinkansen/releases/download/v1.10.0/shinkansen-macos-v1.10.0.pkg`(直連 .pkg,非 release tag page)✅ / options 頁 reload 後也顯示 banner ✅ / 翻譯英文文章 toast 帶 update notice ✅。四項全綠,path A 邏輯在真機跑對。~~

**Part 2:MAS build 編譯期 strip update-check 全套路徑**

- **改動**:新增 `lib/distribution.js`(ES module,給 popup / options / background)+ `lib/distribution-cs.js`(content script,給 content-ns.js 內 `maybeBuildUpdateNotice`)兩檔,皆 export `IS_MAS_BUILD = false`。`safari-app/safari-build.sh` MAS 軌(步驟 1.5)rsync 後將 build 目錄內兩檔 override 成 `true`,drift check(步驟 6)排除這兩檔。Developer ID 軌(`safari-build-devid.sh`)不 override,保持 `false`。
- **動機**:Apple Review Guideline 2.3.10 不准 app 內引導使用者到 App Store 外下載 app;且 MAS 與 Developer ID 用同 Bundle ID(app.shinkansen.macos),使用者點 banner 下載 .pkg 會覆蓋 MAS 安裝讓 MAS 自動更新失效。MAS 上架前必須先 strip。
- **守衛位置**:四處(defense in depth):`update-check.js` `checkForUpdate()` 早退 / `popup.js` banner display 不顯示 / `options.js` `disableUpdateNotice` 視同 true / `content-ns.js` `maybeBuildUpdateNotice` 回 null。
- **manifest 改動**:content_scripts.js array 加 `lib/distribution-cs.js`(必在 content-ns.js 之後,content.js 之前)。

**為什麼進 PENDING(共用理由)**

- 跟 B1/B2 同因 — Playwright fixture extension runtime URL 鎖 `chrome-extension://`,無法 mock 成 `safari-web-extension://` 驗 Safari 分支;另 `tabs.create` 接到的 URL 是否觸發瀏覽器下載對話框是 Safari 系統層級行為,不是 extension 能測的範圍。
- MAS distribution flag 的 build-time override 機制要在真的跑 `safari-build.sh` 後才能驗,且要對比 build 出來的 `.pkg` 內 `lib/distribution.js` 值 = `true`、Developer ID 軌的對應檔 = `false`,屬 build pipeline 驗收非單元測試範圍。

**SANITY 驗收計畫**

1. macOS Safari Developer ID `.pkg` 真機(IS_MAS_BUILD=false):安裝 pkg → 構造 storage `updateAvailable: {version: 'X.Y.Z+1', releaseUrl: '...'}` → popup 顯示 banner + 點下去新 tab 開的 URL 是 `.pkg` 直連且觸發瀏覽器下載 → options 也顯示 banner → 翻譯任意頁面 toast 也帶 update notice。
2. 跑 `./safari-app/safari-build.sh` 後檢查 build 目錄 `Shinkansen Extension/Resources/lib/distribution.js` + `distribution-cs.js` 內容都是 `true`,且 drift check 沒因 distribution 兩檔 fail。
3. MAS `.pkg` 真機(IS_MAS_BUILD=true,先用 unpacked + 手改 distribution.js 模擬,因 MAS 尚未上架):同上構造 storage → popup / options / 翻譯 toast 三處都不顯示 banner。
4. Developer ID 軌跑 `safari-build-devid.sh` 後檢查 build 目錄兩 distribution 檔仍是 `false`(沒被前一輪 MAS build 殘留污染)。

**未來 iOS 守衛**

iOS Safari 同樣是 `safari-web-extension://` scheme 但不能裝 pkg。`project_ios_scope_decisions.md` 記載 iOS 動工等 macOS MAS 過審後啟動,屆時 popup.js Safari 分支需加 `chrome.runtime.getPlatformInfo().os === 'mac'` 守衛,且 iOS build pipeline 也應該走類似 `IS_MAS_BUILD=true` 路徑(iOS 全部走 App Store 上架)。

<!-- v1.9.11 清空紀錄(2026-05-12,Phase 1 macOS Safari 真機驗證 + Phase 1.5 release 完整收尾):

  ★ 兩條皆 **永久 path B**(自動化測試永遠寫不出來),SANITY 視覺驗收完成 + 已 release,
    queue 不再追蹤。原因:options.js 2000+ 行 module top-level side effect 多 + Playwright
    extension runtime URL 鎖 `chrome-extension://` 無法 mock `safari-web-extension://` /
    Playwright Chromium webkit ≠ 真實 Safari webkit baseline 渲染。

  ── B1: v1.9.10 options.js Safari detection 改用 body class + event delegation ──
  - 症狀:macOS Safari 真機 options 頁「翻譯快速鍵」section intro 顯示廢 `chrome://extensions/shortcuts`
    link(Safari 不允許 extension UI 改快速鍵,留 link 對 Safari user 是廢資訊)
  - 修在:`options/options.js` line 1733-1760 + `options/options.css` 加 `body.runtime-safari` rule
  - root cause:原 pattern「per-element addEventListener + inline style」被 `data-i18n-html` 的
    applyI18n 用 innerHTML 重設 `<p>` 時整個吹掉。改用 `document.body.classList.add('runtime-' + platform)`
    + event delegation 綁 document
  - 連帶 fix:Chrome / Firefox 一直被 i18n 吹掉的隱性 anchor click listener bug(沒人發現,
    因為 anchor href="#" 點下去靜悄悄沒事),event delegation 一起解
  - 為什麼永遠寫不出 spec:options.js 2000+ 行 module 含一堆 top-level side effects,
    要 unit test detection 邏輯必須先把 detection 抽 pure function(超出當前 bug fix 範圍,
    沒計畫 refactor);Playwright fixture extension 載入的 runtime URL 鎖 `chrome-extension://`,
    無法 mock 成 `safari-web-extension://` 驗 Safari 分支
  - SANITY:✅ 2026-05-12 macOS Safari 真機已視覺驗收 — Xcode rebuild + Safari reload extension +
    options「翻譯快速鍵」section anchor 隱藏(顯示「鍵位可至 變更」中間空格)

  ── B2: v1.9.11 options.css Safari `<input type="date">` line-height 25px 對齊 ──
  - 症狀:用量紀錄頁面 date input(2026/05/05)在 macOS Safari 上 Y 軸沒跟同 row 的 `00:00`
    select stepper 對齊(視覺偏上 ~7px)
  - 修在:`options/options.css` `body.runtime-safari .usage-date-label input[type="date"]`
    + `::-webkit-datetime-edit` pseudo
  - root cause:Safari 26 macOS 對 `<input type="date">` 即使套 `-webkit-appearance: textfield`,
    內部 `::-webkit-datetime-edit` pseudo-element line-box 仍預設靠 content area 頂端對齊
    (非 center);加上拉丁數字 0-9 visual weight 偏底部,geometric center 對齊 ≠ visual center
  - 修法:`-webkit-appearance: textfield` + `line-height: 25px`(on input + `::-webkit-datetime-edit`)。
    25px 是當前字型(-apple-system + PingFang TC + 13px)的 visual sweet spot
  - 修法歷程(燒 3 輪才鎖到):
    * v1.9.10:`::-webkit-datetime-edit-fields-wrapper` selector(Chrome 內部結構,Safari 不認)
      + `display: flex; align-items: center` → 真機完全沒生效
    * v1.9.11 中間嘗試:`-webkit-appearance: textfield` + `::-webkit-datetime-edit {
      padding: 0; margin: 0; line-height: 1 }` + `padding-top: 4px` → 沒生效
    * v1.9.11 final:加 setTimeout 1.5s 在 options.js 末尾彈紅框 dump 真機 computed style
      (CLAUDE.md §11 真實資料優先,避免再憑視覺猜),從 line-height: 13px(預設) = font-size
      看出 line-box 預設靠頂端對齊 → root cause 鎖死。歷時 30 → 28 → 26 → 25 四輪微調,
      Jimmy 視覺確認 25 pixel-perfect。debug code release 前已拿掉
  - 為什麼永遠寫不出 spec:webkit baseline 渲染差異,Playwright Chromium 跟真實 Safari webkit
    行為不同(Chromium 上已對齊,不會 reproduce);Playwright `playwright.webkit` 跟 Safari
    Web Extension 環境也有差距。完全靠真機視覺驗收
  - SANITY:✅ 2026-05-12 macOS Safari 真機已視覺驗收 line-height 25px pixel-perfect 對齊
-->


<!-- v1.9.5 清空紀錄(2026-05-11):
  - Google Translate 批次 echo 原文 → 逐筆 retry 補救 → 已補
    test/unit/google-translate-batch.spec.js 加 3 條 case(批次內某 unit echo / 整批全 echo /
    retry 仍 echo 維持原值)+ SANITY 驗(註解掉 needsRetry 區塊 → 3 條 fail,還原後全綠)。
    走 unit test 路徑(import lib/google-translate.js + mock globalThis.fetch),
    比 Playwright fixture 模 sendMessage 路徑直接,跟 v1.4.0 既有 7 條測試共用同檔同 mock 模式。
-->


<!-- v1.9.1+ 清空紀錄(2026-05-10):
  - v1.8.68 同 videoId yt-navigate-finish guard → 已補 test/unit/youtube-spa-nav-guard.spec.js
    (7 case + SANITY 過。鎖 guard 邏輯架構:listener 找得到 / 取 newVideoId /
    三段式條件 active+truthy+===videoId / early return / guard 在 reset path 之前 /
    reset path 仍在 / 命中記 'SPA nav skipped' log。SANITY:暫時拔掉 guard 整段 →
    4 條 fail 還原 → 全綠)
  - **訊號層次說明**(§1.1 規則 3):本 spec 鎖「我們的 guard 邏輯寫對」、**不鎖**
    「YouTube 真的會 fire 假性同 videoId 的 yt-navigate-finish」。後者是 YouTube
    內部行為,fixture dispatchEvent 自己 fire 永遠驗不到 — 這層靠 user 觀察 +
    production 體感持續驗證。

  popup 累計費用 path 合一 + 術語表抽取寫入 IndexedDB 兩條退役紀錄見下方
-->

<!-- v1.9.1 清空紀錄(2026-05-10):
  - popup 累計費用 path 合一 → 已補 test/unit/usage-path-architecture.spec.js
    (12 條 case:USAGE_STATS / RESET_USAGE handler 不存在 + addUsage / getUsageStats
    / resetUsageStats / USAGE_KEY 不再定義 + storage.local.set('usageStats') 不存在
    + QUERY_USAGE_STATS handler 仍在且走 usageDB.getStats + popup.js 送
    QUERY_USAGE_STATS / 讀 totalBilledCostUSD / 不送 USAGE_STATS / 不讀 totalCostUSD;
    SANITY:暫時把 USAGE_STATS handler 加回 background.js → 對應 spec fail,
    還原後全綠)
  - 術語表抽取用量寫進 IndexedDB(source='glossary')→ 已補
    test/unit/usage-glossary-record.spec.js(16 條 case:Gemini + OpenAI-compat
    兩條 handler 各驗 logTranslation 呼叫 / source='glossary' / engine 標籤 /
    model 欄位 fallback / billedCostUSD / 包在 if (usage > 0) block 內 / 用
    getCustomCacheHitRate 推 cache 折扣率;SANITY:暫時把 Gemini handler 內的
    usageDB.logTranslation 改名 → 對應 2 條 spec fail,還原後全綠)
-->


<!-- v1.8.46 清空紀錄(2026-05-05):
  - W6 譯文 PDF 下載對 owner-password + AESv2 弱加密 PDF 失敗(Trimble TDC6 SpecSheet)
    → 換 @cantoo/pdf-lib 2.6.5 fork(補 mozilla/pdf.js port 的 AES decrypt)
    + PDFDocument.load 加 { ignoreEncryption: true, password: '' }
    → 已補 test/regression/pdf-download-encrypted.spec.js(SANITY:暫時 revert
      password='' 驗證 spec 正確 fail EncryptedPDFError,還原 fix → pass)
    → fixture 走 docs/excluded(整個 .gitignore),CI 沒檔自動 skip,本機才跑
-->


<!-- v1.8.42 清空紀錄(2026-05-04):
  - non-ASR 雙語改走獨立 overlay + multi-segment dedup → 已補 test/regression/youtube-bilingual-overlay.spec.js
    (4 條 case:雙語不動 segment、雙語 dedup seg2 cached='' 也 push srcBits、純中文 dedup seg2 cached='' 清空 segment、_applyBilingualMode 加 hide class;case 3 已 SANITY 驗過)
  - 同時新加 SK._applyBilingualMode export 給 spec 用
-->


<!-- v1.8.41 清空紀錄(2026-05-04):
  - v1.8.40 YouTube zh-Hant skip → 已補 test/regression/youtube-skip-already-zh-hant.spec.js
    (6 條 case:4 個 zh-Hant/TW/HK/MO 應 skip + en/zh-Hans 對照組應送 API,SANITY 驗過)
  - v1.8.39 translateUnits 段落 hash dedup → 已補 test/regression/translate-dedup-broadcast.spec.js
    + fixtures/translate-dedup-broadcast.html(5 unique + 60 重複段,SANITY 驗過 broadcast 邏輯)
  - 原 v1.8.39 殘留條目「Google Translate 路徑未做 dedup」屬於「功能未做」(非 spec 未寫),
    不符 PENDING_REGRESSION 定位(本檔只追「bug 已修但 spec 未寫」),直接刪掉
-->


<!--
條目格式範例(實際加入時把上面那行 placeholder 刪掉):

### v0.60 — 2026-04-12 — 簡短描述 bug
- **症狀**:Jimmy 觀察到的現象 (例如「Substack 卡片標題被吃掉變空字串」)
- **來源 URL**:https://example.com/some-page (若為公開頁面)
- **修在**:shinkansen/content.js 的 XX 函式 / commit hash
- **為什麼還不能寫測試**:
    例:還沒抽出最小重現結構;原頁面太複雜、含三層 wrapper + 動態載入,
    需要再觀察是哪個 attribute 是真正觸發條件
- **建議 spec 位置**:test/regression/inject-substack-title.spec.js
- **建議 fixture 結構**(若已知):
    ```html
    <article>
      <h2 class="...">
        <span>...</span>
      </h2>
    </article>
    ```
-->
