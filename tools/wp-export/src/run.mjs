import fs from 'node:fs';
import path from 'node:path';
import { createLogger, ensureDir, writeFile, formatBytes } from './util.mjs';
import { loadSql } from './wpdata.mjs';
import { loadWxr } from './wxr.mjs';
import { buildPlan, buildUrlIndex } from './site.mjs';
import { MediaRegistry } from './media.mjs';
import { createLinkResolver } from './links.mjs';
import { buildContent } from './build.mjs';
import { buildRedirects } from './redirects.mjs';
import { exportDesign } from './design.mjs';
import { takeScreenshots } from './screenshots.mjs';
import { validateOutput } from './validate.mjs';
import { buildReport, renderReportMd } from './report.mjs';
import { scanOutput } from './secrets.mjs';

const OWNED = ['content', 'public', 'design-import', 'redirects.csv', 'report.md', 'report.json'];

export const EXIT = { OK: 0, USAGE: 2, SECRETS: 3, EMAILS: 4 };

/**
 * opts: { sql, wxr, wpContent, siteUrl, out, prefix, slugMode, screenshotsFrom,
 *         maxImageMb, allowEmails[], quiet }
 * → { exitCode, report, outDir }
 */
export async function runExport(opts) {
  const log = createLogger({ quiet: opts.quiet });
  const outDir = path.resolve(opts.out || 'export-output');
  if (!opts.sql && !opts.wxr) throw Object.assign(new Error('Нужно указать --sql дамп.sql (или --wxr export.xml).'), { usage: true });
  for (const f of [opts.sql, opts.wxr]) if (f && !fs.existsSync(f)) throw Object.assign(new Error(`Файл не найден: ${f}`), { usage: true });
  const wpContent = opts.wpContent ? path.resolve(opts.wpContent) : null;
  if (wpContent && !fs.existsSync(wpContent)) throw Object.assign(new Error(`Папка не найдена: ${opts.wpContent}`), { usage: true });

  // 1. данные
  log.info('① Читаю данные WordPress…');
  let model;
  if (opts.sql) {
    model = await loadSql(opts.sql, { prefix: opts.prefix, log });
    if (opts.wxr) log.warn('Указаны и --sql, и --wxr: используется SQL-дамп, WXR проигнорирован.');
  } else {
    model = loadWxr(opts.wxr);
    log.warn('Режим WXR: нет списка активных плагинов, темы и настроек — отчёт и дизайн будут неполными.');
  }
  if (opts.siteUrl) model.options.siteurl ||= opts.siteUrl;
  if (!model.options.stylesheet && wpContent && model.source === 'wxr') {
    // в WXR тему определить нельзя; если в themes ровно одна — берём её
    try {
      const dirs = fs.readdirSync(path.join(wpContent, 'themes'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      if (dirs.length === 1) model.options.stylesheet = dirs[0];
    } catch { /* нет */ }
  }
  log.info(`   записей в базе: ${model.posts.size}, пользователей в дампе: ${model.userCount} (их данные не экспортируются)`);

  // 2. план
  const plan = buildPlan(model, { siteUrl: opts.siteUrl, slugMode: opts.slugMode || 'translit', log });
  buildUrlIndex(plan, model);
  if (!plan.site) log.warn('Адрес сайта не определён (--site-url) — внутренние абсолютные ссылки не будут переписаны.');

  // 3. подготовка вывода
  ensureDir(outDir);
  for (const n of OWNED) fs.rmSync(path.join(outDir, n), { recursive: true, force: true });

  // 4. контент
  log.info(`② Конвертирую ${plan.pages.length} страниц и ${plan.posts.length} записей в Markdown…`);
  const maxBytes = Math.round((Number(opts.maxImageMb) || 1) * 1024 * 1024);
  const media = new MediaRegistry({ uploadsDir: wpContent ? path.join(wpContent, 'uploads') : null, maxBytes });
  if (wpContent && !media.uploadsDir) log.warn('В wp-content нет папки uploads — медиа не будет скопировано.');
  const links = createLinkResolver({ plan, model, media });
  const collected = buildContent({ model, plan, media, links, outDir, log });

  // 5. медиа и редиректы
  log.info('③ Копирую используемые файлы и строю redirects.csv…');
  media.copyTo(outDir);
  const mediaStats = media.stats();
  for (const f of mediaStats.heavy) log.warn(`Тяжёлый файл: ${f.file} — ${formatBytes(f.size)} (> ${formatBytes(maxBytes)})`);
  for (const f of mediaStats.missing) log.warn(`Файл из контента не найден: ${f.file}`);
  const redirects = buildRedirects(plan, model, media);
  writeFile(path.join(outDir, 'redirects.csv'), redirects.csv);

  // 6. дизайн
  log.info('④ Экспортирую дизайн темы…');
  const design = exportDesign({ wpContent, model, outDir, plan, media, log });
  design.warnings.forEach((w) => log.warn(w));

  // 7. скриншоты (необязательно)
  let shots = null;
  if (opts.screenshotsFrom) {
    log.info('⑤ Делаю скриншоты…');
    const paths = ['/'];
    for (const n of plan.mainMenu?.roots || []) {
      const e = n.type === 'post_type' ? plan.byId.get(n.objectId) : null;
      const old = e && (plan.oldPaths.get(e.id) || []).find((x) => x.startsWith('/') && !x.startsWith('/?'));
      if (old && !paths.includes(old)) paths.push(old);
    }
    const firstPost = plan.posts[plan.posts.length - 1];
    const fp = firstPost && (plan.oldPaths.get(firstPost.id) || []).find((x) => !x.startsWith('/?'));
    if (fp) paths.push(fp);
    shots = await takeScreenshots({ baseUrl: opts.screenshotsFrom, paths: paths.slice(0, 9), outDir, log });
  }

  // 8. проверка контракта и отчёт
  const validation = validateOutput(outDir);
  for (const p of validation.problems) log.warn(`Контракт: ${p.file}: ${p.error}`);
  const report = buildReport({ model, plan, collected, links, mediaStats, redirects, design, shots, validation, warnings: log.warnings, opts: { maxImageBytes: maxBytes } });

  const skipReports = (rel) => /^report\.(md|json)$/.test(rel);
  const scan = scanOutput(outDir, { canaries: model.canaries, allowEmails: opts.allowEmails || [], skip: skipReports });
  report.secretsScan = { scanned: scan.scanned, hard: scan.hard, emails: scan.emails.map(({ file, email }) => ({ file, email })) };
  writeFile(path.join(outDir, 'report.md'), renderReportMd(report));
  writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, (k, v) => (v instanceof Set ? [...v] : v), 2) + '\n');
  // сами отчёты тоже не должны содержать секретов
  const scan2 = scanOutput(outDir, { canaries: model.canaries, allowEmails: opts.allowEmails || [], skip: (rel) => !skipReports(rel) });
  scan.hard.push(...scan2.hard);
  if (scan2.hard.length) {
    report.secretsScan.hard = scan.hard;
    writeFile(path.join(outDir, 'report.md'), renderReportMd(report));
  }

  // 9. итог
  log.info('');
  log.info(`Готово → ${outDir}`);
  log.info(`   страниц: ${plan.pages.length}, записей: ${plan.posts.length}, медиа: ${mediaStats.copied} (${formatBytes(mediaStats.totalBytes)}), редиректов: ${redirects.rows.length}`);
  log.info(`   отчёт: ${path.join(outDir, 'report.md')}`);

  let exitCode = EXIT.OK;
  if (scan.hard.length) {
    exitCode = EXIT.SECRETS;
    console.error('\n🛑🛑🛑  В ВЫВОДЕ НАЙДЕНЫ СЕКРЕТЫ / ЛИЧНЫЕ ДАННЫЕ  🛑🛑🛑');
    for (const h of scan.hard) console.error(`   ${h.file}: ${h.kind}`);
    console.error('   НЕ КОММИТЬТЕ папку вывода! Удалите найденное и запустите экспорт заново.\n');
  } else if (scan.emails.length) {
    exitCode = EXIT.EMAILS;
    console.error('\n⚠️⚠️⚠️  В ТЕКСТЕ НАЙДЕНЫ E-MAIL АДРЕСА  ⚠️⚠️⚠️');
    for (const e of scan.emails) console.error(`   ${e.file}: ${e.email}`);
    console.error('   Репозиторий публичный. Если это публичные контакты клуба, повторите запуск с флагом --allow-email <адрес>\n   (или --allow-email @домен). Иначе уберите адреса из текста. Пока не подтверждено — не коммитьте.\n');
  } else {
    log.info('   ✔ проверка на секреты и e-mail пройдена');
  }
  return { exitCode, report, outDir };
}
