// Поиск по сайту: статический индекс Pagefind (папка /pagefind/, строится после astro build). Сервера нет.
// Лежит в public/, а не в src/: Vite иначе оборачивает динамический import() своим хелпером.
// Поиск — статический индекс Pagefind, который строится после astro build (папка /pagefind/). Сервера нет.
const input = document.querySelector('#q');
const status = document.querySelector('#status');
const list = document.querySelector('#results');
const form = input.form;
const params = new URLSearchParams(location.search);
let pf;

async function load() {
  if (pf) return pf;
  const url = '/pagefind/pagefind.js';
  pf = await import(url);
  await pf.options({ baseUrl: '/' });
  return pf;
}

async function run(q) {
  list.replaceChildren();
  if (!q.trim()) {
    status.textContent = 'Введите запрос.';
    return;
  }
  status.textContent = 'Ищем…';
  try {
    const search = await (await load()).search(q);
    const hits = await Promise.all(search.results.slice(0, 30).map((r) => r.data()));
    status.textContent = hits.length ? `Найдено: ${search.results.length}` : 'Ничего не найдено. Попробуйте другие слова.';
    for (const h of hits) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = h.url;
      a.textContent = h.meta?.title || h.url;
      const p = document.createElement('p');
      p.innerHTML = h.excerpt; // excerpt от Pagefind: текст сайта с <mark>, экранирован индексатором
      li.append(a, p);
      list.append(li);
    }
  } catch (err) {
    console.error(err);
    status.textContent = 'Поиск сейчас недоступен (индекс строится при публикации сайта).';
  }
}

const q = params.get('q') ?? '';
input.value = q;
if (q) run(q);
form.addEventListener('submit', (e) => {
  e.preventDefault();
  history.replaceState(null, '', `?q=${encodeURIComponent(input.value)}`);
  run(input.value);
});
