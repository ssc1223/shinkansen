// distribution.js — 編譯期注入的「是否 MAS build」flag。
//
// 為什麼有這個檔:同一份 extension source 會在多個通路發布,但只有 Mac App Store
// 必須在 build 階段拿掉 update-check banner 那條路徑。
//   - Apple App Store Review Guideline 2.3.10 不准 app 內引導使用者到 App Store
//     外的通路下載 app,banner 直連 GitHub Release .pkg 會被審查 reject
//   - 即便 ship 上架,MAS 跟 Developer ID .pkg 用同 Bundle ID
//     (app.shinkansen.macos),使用者點 banner 下載 Developer ID .pkg 雙擊安裝會
//     覆蓋 MAS 安裝,從此 MAS 不再自動更新
//
// 機制:
//   - `safari-app/safari-build.sh`(MAS 軌)在 rsync `shinkansen/` 到 Resources/
//     之後,把 Resources/lib/distribution.js 內容改寫成 `true`,再 archive。
//     drift check 排除本檔。
//   - 其他通路(Chrome / Firefox / Developer ID / unpacked dev)維持預設 `false`,
//     由 update-check.js 內 isManualInstall() 用 manifest.update_url 各自分流。
//
// 讀者:
//   - `lib/update-check.js` `checkForUpdate()` 開頭,IS_MAS_BUILD 直接 return
//   - `popup/popup.js` 顯示 update banner 前,IS_MAS_BUILD 強制不顯示
//     (defense in depth — 即使 storage 殘留 updateAvailable 也不會錯顯)

export const IS_MAS_BUILD = false;
