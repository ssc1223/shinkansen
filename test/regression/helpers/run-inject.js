// Shinkansen 回歸測試共用 helper (v0.59 新增)
//
// 兩個職責:
//   1. loadFixtureResponse(name)
//      讀 test/regression/fixtures/<name>.response.txt 的內容 (canned LLM 回應)。
//      HTML fixture 本身是給 localServer 直接 serve 的,不需要 Node 端讀。
//
//   2. getShinkansenEvaluator(page)
//      跟 test/edo-detection.spec.js 同樣的 CDP isolated world evaluator,
//      讓 spec 能在 Shinkansen content script isolated world 內呼叫
//      window.__shinkansen.testInject(...) 等 debug API。
//
// 為什麼非 CDP 不可:Playwright 的 page.evaluate(fn) 一律跑在 page main world,
// 看不到 content script isolated world 的 window.__shinkansen,
// 必須走 Chrome DevTools Protocol 指定 contextId 才能呼叫到。
// 細節 (Runtime.executionContextCreated 必須在 enable 之前掛、auxData.type
// 為 'isolated' 的篩選邏輯等) 見 edo-detection.spec.js 開頭註解。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

export function loadFixtureResponse(name) {
  const respPath = path.join(FIXTURES_DIR, `${name}.response.txt`);
  // .response.txt 末尾的尾隨 \n 是 editor 自動加的,canned LLM 回應裡不應該
  // 帶它,否則會在 deserializer 後面留下多餘的空白文字節點。
  return fs.readFileSync(respPath, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+$/, '');
}

export async function getShinkansenEvaluator(page) {
  const cdp = await page.context().newCDPSession(page);

  const contexts = [];
  cdp.on('Runtime.executionContextCreated', (event) => {
    contexts.push(event.context);
  });
  cdp.on('Runtime.executionContextDestroyed', (event) => {
    const idx = contexts.findIndex((c) => c.id === event.executionContextId);
    if (idx >= 0) contexts.splice(idx, 1);
  });

  await cdp.send('Runtime.enable');
  await page.waitForTimeout(500);

  const isolated = contexts.filter((c) => c?.auxData?.type === 'isolated');
  let shinkansen = isolated.find((c) => c.name === 'Shinkansen');
  if (!shinkansen) {
    shinkansen = isolated.find((c) => /Shinkansen/i.test(c.name || ''));
  }
  if (!shinkansen) {
    const dump = isolated.map((c) => ({
      id: c.id, name: c.name, origin: c.origin, auxData: c.auxData,
    }));
    throw new Error(
      `找不到 Shinkansen isolated world execution context。\n候選: ${JSON.stringify(dump, null, 2)}`,
    );
  }

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', {
      contextId: shinkansen.id,
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `Runtime.evaluate 失敗: ${result.exceptionDetails.text}\nexpression: ${expression}`,
      );
    }
    return result.result.value;
  }

  return { cdp, contextId: shinkansen.id, contextName: shinkansen.name, evaluate };
}

/**
 * 在 isolated world 對指定 selector 命中的 element 跑 testInject。
 * 為什麼把這個包起來:讓 spec 不用每次手寫長串的 expression 字串拼接,
 * 也讓「element 必須存在」這個前置斷言只寫一次。
 */
export async function runTestInject(evaluate, targetSelector, translation) {
  const expr = `
    (() => {
      const el = document.querySelector(${JSON.stringify(targetSelector)});
      if (!el) throw new Error('runTestInject: target not found: ' + ${JSON.stringify(targetSelector)});
      return window.__shinkansen.testInject(el, ${JSON.stringify(translation)});
    })()
  `;
  return evaluate(expr);
}
