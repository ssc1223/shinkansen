// Regression: general page bilingual inline rendering
//
// 一般網頁翻譯應保留原文，並把譯文插在原段落/清單項目下方，方便使用者對照。
// YouTube 字幕有獨立雙語渲染路徑，本測試鎖住非 YouTube 的一般頁面路徑。
import { test, expect } from '../fixtures/extension.js';
import { getShinkansenEvaluator } from './helpers/run-inject.js';

const FIXTURE = 'bilingual-inline';

test('bilingual-inline: paragraph 與 list item 應保留原文並在下方顯示譯文', async ({
  context,
  localServer,
}) => {
  const page = await context.newPage();
  await page.goto(`${localServer.baseUrl}/${FIXTURE}.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#lead', { timeout: 10_000 });

  const { evaluate } = await getShinkansenEvaluator(page);

  const result = await evaluate(`
    JSON.stringify((() => {
      const lead = document.querySelector('#lead');
      const li = document.querySelector('#bait-depth');

      const leadSerialized = window.__SK.serializeWithPlaceholders(lead);
      window.__SK.injectTranslation(
        { kind: 'element', el: lead },
        '浮釣可能是最常見的釣魚方式。如果操作得當，它對於捕捉幾乎任何魚類都非常有效。',
        leadSerialized.slots,
        { mode: 'bilingual' },
      );

      const liSerialized = window.__SK.serializeWithPlaceholders(li);
      window.__SK.injectTranslation(
        { kind: 'element', el: li },
        '它可以將魚餌懸浮在預定的深度。',
        liSerialized.slots,
        { mode: 'bilingual' },
      );

      const leadTranslation = lead.nextElementSibling;
      const liTranslation = Array.from(li.children).find(el =>
        el.matches('[data-shinkansen-translation]')
      );
      const unitsAfterInject = window.__SK.collectParagraphs().map(u =>
        (u.textPreview || '').trim()
      );

      return {
        leadText: lead.textContent.trim(),
        leadTag: leadTranslation?.tagName,
        leadTranslationText: leadTranslation?.textContent.trim(),
        leadTranslationLang: leadTranslation?.getAttribute('lang'),
        liText: li.childNodes[0].textContent.trim(),
        liTranslationText: liTranslation?.textContent.trim(),
        liTranslationParentId: liTranslation?.parentElement?.id,
        unitsAfterInject,
      };
    })())
  `);

  const data = JSON.parse(result);

  expect(data.leadText).toContain('Float fishing is probably the most common fishing method.');
  expect(data.leadTag).toBe('P');
  expect(data.leadTranslationText).toBe('浮釣可能是最常見的釣魚方式。如果操作得當，它對於捕捉幾乎任何魚類都非常有效。');
  expect(data.leadTranslationLang).toBe('zh-Hant');

  expect(data.liText).toBe('it can suspend the bait at a predetermined depth.');
  expect(data.liTranslationParentId).toBe('bait-depth');
  expect(data.liTranslationText).toBe('它可以將魚餌懸浮在預定的深度。');

  expect(data.unitsAfterInject.some(t => t.includes('浮釣可能'))).toBe(false);
  expect(data.unitsAfterInject.some(t => t.includes('Float fishing'))).toBe(false);
  expect(data.unitsAfterInject.some(t => t.includes('bait at a predetermined depth'))).toBe(false);

  await page.close();
});

test('replace-original: 勾選後應替換原文而非插入雙語譯文', async ({
  context,
  localServer,
}) => {
  const page = await context.newPage();
  await page.goto(`${localServer.baseUrl}/${FIXTURE}.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#lead', { timeout: 10_000 });

  const { evaluate } = await getShinkansenEvaluator(page);

  const result = await evaluate(`
    (async () => {
      const originalSendMessage = browser.runtime.sendMessage;
      browser.runtime.sendMessage = async (message) => {
        if (message?.type === 'TRANSLATE_BATCH') {
          return {
            ok: true,
            result: ['浮釣可能是最常見的釣魚方式。'],
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cachedTokens: 0,
              costUSD: 0,
              billedInputTokens: 0,
              billedCostUSD: 0,
              cacheHits: 0,
            },
          };
        }
        return { ok: true };
      };

      try {
        const lead = document.querySelector('#lead');
        await window.__SK.translateUnits(
          [{ kind: 'element', el: lead }],
          { replaceOriginal: true },
        );

        const data = {
          leadText: lead.textContent.trim(),
          translationCount: document.querySelectorAll('[data-shinkansen-translation]').length,
          sourceTranslated: lead.hasAttribute('data-shinkansen-source-translated'),
        };
        return JSON.stringify(data);
      } finally {
        browser.runtime.sendMessage = originalSendMessage;
      }
    })()
  `);

  const data = JSON.parse(result);

  expect(data.leadText).toBe('浮釣可能是最常見的釣魚方式。');
  expect(data.translationCount).toBe(0);
  expect(data.sourceTranslated).toBe(false);

  await page.close();
});
