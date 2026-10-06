import path from 'node:path';
import { ensureDir, writeFile } from './util.mjs';
import { slugify } from './slug.mjs';

/**
 * Необязательный шаг: скриншоты живого (или локального) сайта через Playwright.
 * Playwright не входит в зависимости: `npm i playwright && npx playwright install chromium`.
 * Любая ошибка — только предупреждение, основной экспорт не ломается.
 */
export async function takeScreenshots({ baseUrl, paths, outDir, log }) {
  const res = { ok: false, shots: [], error: null };
  let pw;
  try {
    pw = await import('playwright');
  } catch {
    try { pw = await import('playwright-core'); } catch { /* нет */ }
  }
  if (!pw) {
    res.error = 'Playwright не установлен. Выполните в tools/wp-export: npm i playwright && npx playwright install chromium';
    log?.warn?.(`Скриншоты пропущены: ${res.error}`);
    return res;
  }
  const dir = path.join(outDir, 'design-import', 'screenshots');
  ensureDir(dir);
  let browser;
  try {
    browser = await (pw.chromium || pw.default?.chromium).launch();
    const viewports = [
      ['desktop', { width: 1440, height: 900 }],
      ['mobile', { width: 390, height: 844 }],
    ];
    for (const [name, vp] of viewports) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: name === 'mobile' });
      for (const p of paths) {
        const url = new URL(p, baseUrl).href;
        const slug = p === '/' || p === '' ? 'home' : slugify(p, 'translit') || 'page';
        const file = `${slug}-${name}.png`;
        const page = await ctx.newPage();
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
          await page.screenshot({ path: path.join(dir, file), fullPage: true });
          res.shots.push({ url, viewport: name, file: `design-import/screenshots/${file}` });
        } catch (e) {
          log?.warn?.(`Скриншот ${url} (${name}) не получился: ${e.message.split('\n')[0]}`);
        } finally {
          await page.close();
        }
      }
      await ctx.close();
    }
    res.ok = res.shots.length > 0;
  } catch (e) {
    res.error = e.message.split('\n')[0];
    log?.warn?.(`Скриншоты пропущены: ${res.error}`);
  } finally {
    await browser?.close().catch(() => {});
  }
  writeFile(path.join(dir, 'index.json'), JSON.stringify(res.shots, null, 2) + '\n');
  return res;
}
