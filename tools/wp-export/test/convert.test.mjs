import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown } from '../src/html2md.mjs';
import { contentToMarkdown, wpautop, makeDescription } from '../src/content.mjs';
import { slugify } from '../src/slug.mjs';

const env = (extra = {}) => ({ rewriteUrl: (u) => u, onEmbed() {}, onForm() {}, onNote() {}, onShortcode() {}, ...extra });

test('HTML → Markdown: заголовки, списки, таблицы, ссылки, картинки', () => {
  const md = htmlToMarkdown('<h1>A</h1><h3>B</h3><p>Текст <b>жирный</b> и <em>курсив</em> &amp; <a href="/x/">ссылка</a></p><ol><li>1<ul><li>в</li></ul></li><li>2</li></ol><table><tr><th>X</th><th>Y</th></tr><tr><td>1</td><td>a|b</td></tr></table><p><img src="/a.jpg" alt="алт"></p><hr><blockquote><p>цитата</p></blockquote><pre><code class="language-js">let a = 1;</code></pre>');
  assert.match(md, /^## A$/m); // h1 → h2
  assert.match(md, /^#### B$/m); // сдвиг уровней
  assert.match(md, /Текст \*\*жирный\*\* и \*курсив\* & \[ссылка\]\(\/x\/\)/);
  assert.match(md, /1\. 1\n   - в\n2\. 2/);
  assert.match(md, /\| X \| Y \|\n\| --- \| --- \|\n\| 1 \| a\\\|b \|/);
  assert.match(md, /!\[алт\]\(\/a\.jpg\)/);
  assert.match(md, /^---$/m);
  assert.match(md, /^> цитата$/m);
  assert.match(md, /```js\nlet a = 1;\n```/);
});

test('HTML: script/style/формы выбрасываются, комментарии убираются', () => {
  let forms = 0;
  const md = htmlToMarkdown('<p>a</p><script>alert(1)</script><style>p{}</style><!-- hidden --><form><input name="x"><button>Go</button></form>', env({ onForm: () => forms++ }));
  assert.ok(!/alert|hidden|Go/.test(md));
  assert.equal(forms, 1);
});

test('Gutenberg: комментарии блоков убираются, <!--more--> тоже, embed YouTube → iframe', () => {
  const embeds = [];
  const md = contentToMarkdown(
    '<!-- wp:paragraph -->\n<p>Привет</p>\n<!-- /wp:paragraph -->\n<!-- wp:more -->\n<!--more-->\n<!-- /wp:more -->\n<!-- wp:embed {"url":"x"} -->\n<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n</div></figure>\n<!-- /wp:embed -->',
    env({ onEmbed: (e) => embeds.push(e) }), 1);
  assert.ok(!/wp:/.test(md));
  assert.match(md, /Привет/);
  assert.match(md, /<iframe src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/);
  assert.equal(embeds[0].kind, 'youtube');
});

test('Gutenberg: повторно используемый блок подставляется', () => {
  const md = contentToMarkdown('<!-- wp:block {"ref":7} /-->', env({ reusableBlocks: new Map([[7, '<p>Из блока</p>']]) }), 1);
  assert.match(md, /Из блока/);
});

test('шорткоды: caption, gallery, формы, неизвестные, «обычные» скобки', () => {
  const notes = [];
  const sc = [];
  const md = contentToMarkdown(
    'Текст [Фото] остаётся.\n\n[caption id="a" width="1"]<img src="/p.jpg" alt="x"> Подпись[/caption]\n\n[gallery ids="1,2"]\n\n[contact-form-7 id="5"]\n\n[my_widget x="1"]\n\n[button url="/go/"]Жми[/button]',
    env({
      attachmentUrl: (id) => ({ url: `/wp-content/uploads/g${id}.jpg`, alt: '' }),
      onForm: () => notes.push('form'),
      onShortcode: (n, k) => sc.push(`${n}:${k}`),
    }), 1);
  assert.match(md, /\\\[Фото\\\] остаётся/);
  assert.match(md, /!\[x\]\(\/p\.jpg\)\n\n\*Подпись\*/);
  assert.match(md, /!\[\]\(\/wp-content\/uploads\/g1\.jpg\)/);
  assert.match(md, /!\[\]\(\/wp-content\/uploads\/g2\.jpg\)/);
  assert.match(md, /TODO\(wp-export\): форма \[contact-form-7\]/);
  assert.match(md, /TODO\(wp-export\): шорткод \[my_widget\]/);
  assert.match(md, /\[Жми\]\(\/go\/\)/);
  assert.deepEqual(notes, ['form']);
  assert.ok(sc.includes('my_widget:unknown'));
});

test('wpautop: абзацы и переносы', () => {
  assert.equal(wpautop('a\nb\n\nc'), '<p>a<br>\nb</p>\n\n<p>c</p>');
  assert.equal(wpautop('<ul><li>x</li></ul>'), '<ul><li>x</li></ul>');
});

test('description из первого абзаца', () => {
  assert.equal(makeDescription('# Заголовок\n\nКороткий.\n\nДостаточно длинный абзац для описания страницы, который стоит использовать.'), 'Достаточно длинный абзац для описания страницы, который стоит использовать.');
});

test('slug: транслитерация и сохранение кириллицы', () => {
  assert.equal(slugify('%d0%a1%d0%be%d1%80%d0%b5%d0%b2%d0%bd%d0%be%d0%b2%d0%b0%d0%bd%d0%b8%d1%8f-2021'), 'sorevnovaniya-2021');
  assert.equal(slugify('Щётка & Ёж!'), 'shchyotka-yozh');
  assert.equal(slugify('Первый турнир', 'keep'), 'первый-турнир');
  assert.equal(slugify('---'), '');
});
