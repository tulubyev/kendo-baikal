#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runExport, EXIT } from '../src/run.mjs';

const HELP = `Экспорт WordPress → Astro (kendo-baikal)

Использование:
  node tools/wp-export/bin/export.mjs --sql dump.sql --wp-content ./wp-content \\
       --site-url https://kendo-baikal.ru --out export-output/

Параметры:
  --sql <файл>            SQL-дамп (mysqldump; .sql или .sql.gz)
  --wxr <файл>            запасной вариант: XML из WordPress → Инструменты → Экспорт
  --wp-content <папка>    копия папки wp-content (uploads, themes)
  --site-url <url>        адрес старого сайта (по умолчанию из настроек WP)
  --out <папка>           куда писать результат (по умолчанию export-output)
  --prefix <wp_>          префикс таблиц, если в дампе их несколько наборов
  --slug-mode <режим>     translit (по умолчанию) | keep — оставлять кириллицу в адресах
  --screenshots-from <url>  сделать скриншоты сайта (нужен playwright; необязательно)
  --max-image-mb <число>  порог предупреждения о тяжёлых файлах (по умолчанию 1)
  --allow-email <адрес|@домен>  разрешить публичный e-mail в тексте (можно несколько раз)
  --download-remote       скачать внешние картинки (VK, Photon и др.) в public/uploads/remote/ (нужен интернет;
                          рекомендуется). Повторный запуск берёт готовое из <out>/.remote-cache
  --remote-max-mb <число> лимит размера одного скачиваемого файла (по умолчанию 25)
  --redact-user-emails    скрывать e-mail пользователей WordPress в тексте → [адрес скрыт] (включено по умолчанию)
  --keep-user-emails      НЕ скрывать e-mail пользователей (посторонние адреса всё равно требуют --allow-email)
  --quiet                 меньше сообщений
  -h, --help              эта справка

Коды выхода: 0 — всё хорошо; 2 — ошибка запуска; 3 — найдены секреты; 4 — найдены e-mail (нужно подтвердить).
`;

let values;
try {
  ({ values } = parseArgs({
    options: {
      sql: { type: 'string' },
      wxr: { type: 'string' },
      'wp-content': { type: 'string' },
      'site-url': { type: 'string' },
      out: { type: 'string' },
      prefix: { type: 'string' },
      'slug-mode': { type: 'string' },
      'screenshots-from': { type: 'string' },
      'max-image-mb': { type: 'string' },
      'allow-email': { type: 'string', multiple: true },
      'download-remote': { type: 'boolean' },
      'remote-max-mb': { type: 'string' },
      'redact-user-emails': { type: 'boolean' },
      'keep-user-emails': { type: 'boolean' },
      quiet: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  }));
} catch (e) {
  console.error(`Ошибка параметров: ${e.message}\n\n${HELP}`);
  process.exit(EXIT.USAGE);
}
if (values.help) {
  console.log(HELP);
  process.exit(0);
}
if (values['slug-mode'] && !['translit', 'keep'].includes(values['slug-mode'])) {
  console.error('--slug-mode: допустимо translit или keep');
  process.exit(EXIT.USAGE);
}

if (values['keep-user-emails'] && values['redact-user-emails']) {
  console.error('--redact-user-emails и --keep-user-emails взаимоисключающие: выберите один (по умолчанию e-mail скрываются).');
  process.exit(EXIT.USAGE);
}
if (values['remote-max-mb'] && !(Number(values['remote-max-mb']) > 0)) {
  console.error('--remote-max-mb: нужно положительное число');
  process.exit(EXIT.USAGE);
}

try {
  const { exitCode } = await runExport({
    sql: values.sql,
    wxr: values.wxr,
    wpContent: values['wp-content'],
    siteUrl: values['site-url'],
    out: values.out,
    prefix: values.prefix,
    slugMode: values['slug-mode'],
    screenshotsFrom: values['screenshots-from'],
    maxImageMb: values['max-image-mb'],
    allowEmails: values['allow-email'],
    downloadRemote: values['download-remote'],
    remoteMaxMb: values['remote-max-mb'],
    keepUserEmails: values['keep-user-emails'],
    quiet: values.quiet,
  });
  process.exit(exitCode);
} catch (e) {
  if (e.usage) {
    console.error(`Ошибка: ${e.message}\n\n${HELP}`);
    process.exit(EXIT.USAGE);
  }
  console.error(`Непредвиденная ошибка: ${e.stack || e}`);
  process.exit(1);
}
