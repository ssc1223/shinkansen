// Regression: sticky must stay tab-scoped（v1.5.5 停用跨 tab sticky 繼承）
//
// 使用者在 tab A 翻譯後，透過 `window.open` / `target="_blank"` / Ctrl+Click 開新 tab B。
// 舊行為會看 `openerTabId` 並把 A 的 sticky slot 複製給 B，導致 B 未經使用者操作
// 也自動翻譯。現在 sticky 只屬於原本的 tab；新 tab 必須回 shouldTranslate=false。
//
// 策略：不跑完整翻譯流程（避免依賴 mock Gemini API）。直接用 STICKY_SET 訊息把 tab A
// 塞進 stickyTabs Map，再觀察新 tab 的 STICKY_QUERY 回應。這驗證到的正是使用者回報的
// bug surface：新 tab / 新視窗不應自動帶入翻譯狀態。
//
// 兩個 test：
//   (1) 有 opener（window.open）→ 新 tab 不繼承 slot
//   (2) tab A 的 sticky / clear 都不會改變 tab B 的狀態
import { test, expect } from '../fixtures/extension.js';
import { getShinkansenEvaluator } from './helpers/run-inject.js';

const SLOT = 2;  // 用 slot 2 (Flash) 測試

// 共用：在指定 page 的 isolated world 送 runtime message，回傳結果
// 用 WeakMap 快取 evaluator：每次 getShinkansenEvaluator 會開新 CDP session 並 wait 500ms，
// 多次 message 重複開會大幅拖慢測試，一個 page 快取一個 evaluator 即可。
const _evalCache = new WeakMap();
async function sendMessageFrom(page, msg) {
  let evaluate = _evalCache.get(page);
  if (!evaluate) {
    evaluate = (await getShinkansenEvaluator(page)).evaluate;
    _evalCache.set(page, evaluate);
  }
  // 包 async IIFE：Runtime.evaluate 的 awaitPromise 只等「表達式本身就是 promise」的情況，
  // 單獨的 `await` 在 top level 會是 syntax error。
  return JSON.parse(
    await evaluate(`(async () => JSON.stringify(await chrome.runtime.sendMessage(${JSON.stringify(msg)})))()`)
  );
}

// 共用：輪詢 STICKY_QUERY 等最多 timeout ms 讓 onCreated listener 完成
async function waitForStickyQuery(page, expectTranslate, timeoutMs = 3000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await sendMessageFrom(page, { type: 'STICKY_QUERY' });
      if (last?.shouldTranslate === expectTranslate) return last;
    } catch (_) { /* page might not be ready yet */ }
    await page.waitForTimeout(100);
  }
  return last;
}

test('sticky-cross-tab: tab A 有 sticky + window.open → tab B 不應繼承 slot', async ({
  context,
  localServer,
}) => {
  // Page A goto fixture (任意有 content script 的頁面即可)
  const pageA = await context.newPage();
  await pageA.goto(`${localServer.baseUrl}/br-paragraph.html`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForSelector('#target', { timeout: 10_000 });

  // Page A 送 STICKY_SET 把自己塞進 stickyTabs Map
  const setResp = await sendMessageFrom(pageA, { type: 'STICKY_SET', payload: { slot: SLOT } });
  expect(setResp?.ok, 'STICKY_SET 應成功').toBe(true);

  // Sanity: Page A 的 STICKY_QUERY 應回 shouldTranslate=true, slot=SLOT
  const queryA = await sendMessageFrom(pageA, { type: 'STICKY_QUERY' });
  expect(queryA?.shouldTranslate, 'Page A 設完 sticky 後自己 query 應 true').toBe(true);
  expect(queryA?.slot, 'Page A 的 sticky slot').toBe(SLOT);

  // Page A 觸發 window.open 開 Page B，同時等 context 送出 'page' event
  const pageBPromise = context.waitForEvent('page');
  await pageA.evaluate((url) => { window.open(url, '_blank'); },
    `${localServer.baseUrl}/br-paragraph.html`);
  const pageB = await pageBPromise;
  await pageB.waitForLoadState('domcontentloaded');
  await pageB.waitForSelector('#target', { timeout: 10_000 });

  const queryB = await waitForStickyQuery(pageB, false);

  // 核心斷言：Page B 不繼承 sticky
  expect(
    queryB?.shouldTranslate,
    `Page B（有 opener）不應繼承 sticky，實際 ${JSON.stringify(queryB)}`,
  ).toBe(false);
  expect(
    queryB?.slot,
    `Page B slot 應為 null，實際 ${JSON.stringify(queryB)}`,
  ).toBeNull();

  await pageB.close();
  await pageA.close();
});

test('sticky-cross-tab: tab A STICKY_SET / STICKY_CLEAR 不影響 tab B（per-tab 獨立）', async ({
  context,
  localServer,
}) => {
  const pageA = await context.newPage();
  await pageA.goto(`${localServer.baseUrl}/br-paragraph.html`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForSelector('#target', { timeout: 10_000 });

  await sendMessageFrom(pageA, { type: 'STICKY_SET', payload: { slot: SLOT } });

  // 開 Page B：不應繼承 A 的 sticky
  const pageBPromise = context.waitForEvent('page');
  await pageA.evaluate((url) => { window.open(url, '_blank'); },
    `${localServer.baseUrl}/br-paragraph.html`);
  const pageB = await pageBPromise;
  await pageB.waitForLoadState('domcontentloaded');
  await pageB.waitForSelector('#target', { timeout: 10_000 });
  const queryBInit = await waitForStickyQuery(pageB, false);
  expect(queryBInit?.shouldTranslate, 'sanity: Page B 一開始不應繼承 sticky').toBe(false);

  // Page A 送 STICKY_CLEAR（模擬按快捷鍵還原原文的情境）
  const clearResp = await sendMessageFrom(pageA, { type: 'STICKY_CLEAR' });
  expect(clearResp?.ok).toBe(true);

  // Page A 自己的 query 應變 false
  const queryAAfter = await sendMessageFrom(pageA, { type: 'STICKY_QUERY' });
  expect(
    queryAAfter?.shouldTranslate,
    `Page A 送 STICKY_CLEAR 後自己應為 false，實際 ${JSON.stringify(queryAAfter)}`,
  ).toBe(false);

  // Page B 仍應維持未 sticky（per-tab 獨立）
  const queryBAfter = await sendMessageFrom(pageB, { type: 'STICKY_QUERY' });
  expect(
    queryBAfter?.shouldTranslate,
    `Page B 不應被 Page A 的 SET/CLEAR 影響（per-tab 獨立），實際 ${JSON.stringify(queryBAfter)}`,
  ).toBe(false);
  expect(queryBAfter?.slot).toBeNull();

  await pageB.close();
  await pageA.close();
});
