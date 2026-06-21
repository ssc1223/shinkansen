// Regression: tab-scoped sticky 翻譯（fork 行為：不跨 tab 繼承）
//
// 你的 fork 刻意把原作者 v1.4.11 的「跨 tab sticky 繼承」改成 tab-scoped：
//   - 同一 tab reload / back-forward 可保留自己的 preset slot
//   - window.open / target=_blank / Cmd+Click 開出的新 tab 不自動繼承
//
// 目的：避免使用者只是從已翻譯頁面開新分頁，就在未明確操作下自動翻譯新頁。
// 因此本 spec 鎖住 fork 行為，避免未來 merge upstream 時把 cross-tab inheritance 帶回來。
import { test, expect } from '../fixtures/extension.js';
import { getShinkansenEvaluator } from './helpers/run-inject.js';

const SLOT = 2;  // 用 slot 2 (Flash) 測試

// 共用：在指定 page 的 isolated world 送 runtime message，回傳結果
const _evalCache = new WeakMap();
async function sendMessageFrom(page, msg) {
  let evaluate = _evalCache.get(page);
  if (!evaluate) {
    evaluate = (await getShinkansenEvaluator(page)).evaluate;
    _evalCache.set(page, evaluate);
  }
  return JSON.parse(
    await evaluate(`(async () => JSON.stringify(await chrome.runtime.sendMessage(${JSON.stringify(msg)})))()`)
  );
}

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

test('sticky tab-scoped: tab A 有 sticky + window.open → tab B 不繼承', async ({
  context,
  localServer,
}) => {
  const pageA = await context.newPage();
  await pageA.goto(`${localServer.baseUrl}/br-paragraph.html`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForSelector('#target', { timeout: 10_000 });

  const setResp = await sendMessageFrom(pageA, { type: 'STICKY_SET', payload: { slot: SLOT } });
  expect(setResp?.ok, 'STICKY_SET 應成功').toBe(true);

  const queryA = await sendMessageFrom(pageA, { type: 'STICKY_QUERY' });
  expect(queryA?.shouldTranslate, 'Page A 設完 sticky 後自己 query 應 true').toBe(true);
  expect(queryA?.slot, 'Page A 的 sticky slot').toBe(SLOT);

  const pageBPromise = context.waitForEvent('page');
  await pageA.evaluate((url) => { window.open(url, '_blank'); },
    `${localServer.baseUrl}/br-paragraph.html`);
  const pageB = await pageBPromise;
  await pageB.waitForLoadState('domcontentloaded');
  await pageB.waitForSelector('#target', { timeout: 10_000 });

  const queryB = await waitForStickyQuery(pageB, false);
  expect(
    queryB?.shouldTranslate,
    `Page B（window.open 新 tab）不應繼承 sticky，實際 ${JSON.stringify(queryB)}`,
  ).toBe(false);
  expect(
    queryB?.slot ?? null,
    `Page B slot 應為 null，實際 ${JSON.stringify(queryB)}`,
  ).toBe(null);

  await pageB.close();
  await pageA.close();
});

test('sticky tab-scoped: tab A STICKY_CLEAR 只清自己的 sticky，新 tab 仍維持不繼承', async ({
  context,
  localServer,
}) => {
  const pageA = await context.newPage();
  await pageA.goto(`${localServer.baseUrl}/br-paragraph.html`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForSelector('#target', { timeout: 10_000 });

  await sendMessageFrom(pageA, { type: 'STICKY_SET', payload: { slot: SLOT } });

  const pageBPromise = context.waitForEvent('page');
  await pageA.evaluate((url) => { window.open(url, '_blank'); },
    `${localServer.baseUrl}/br-paragraph.html`);
  const pageB = await pageBPromise;
  await pageB.waitForLoadState('domcontentloaded');
  await pageB.waitForSelector('#target', { timeout: 10_000 });
  const queryBInit = await waitForStickyQuery(pageB, false);
  expect(queryBInit?.shouldTranslate, 'sanity: Page B 一開始不應繼承 sticky').toBe(false);

  const clearResp = await sendMessageFrom(pageA, { type: 'STICKY_CLEAR' });
  expect(clearResp?.ok).toBe(true);

  const queryAAfter = await sendMessageFrom(pageA, { type: 'STICKY_QUERY' });
  expect(
    queryAAfter?.shouldTranslate,
    `Page A 送 STICKY_CLEAR 後自己應為 false，實際 ${JSON.stringify(queryAAfter)}`,
  ).toBe(false);

  const queryBAfter = await sendMessageFrom(pageB, { type: 'STICKY_QUERY' });
  expect(
    queryBAfter?.shouldTranslate,
    `Page B 不應因 Page A 曾有 sticky 而繼承，實際 ${JSON.stringify(queryBAfter)}`,
  ).toBe(false);
  expect(queryBAfter?.slot ?? null).toBe(null);

  await pageB.close();
  await pageA.close();
});
