import { getCollection, type CollectionEntry } from 'astro:content';
import { SITE } from '../site.config';

export type Page = CollectionEntry<'pages'>;
export type Post = CollectionEntry<'posts'>;

/** Черновики (draft: true) не попадают ни в сборку, ни в меню, ни в RSS. */
export const getPages = (): Promise<Page[]> => getCollection('pages', ({ data }) => !data.draft);

export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export const pageUrl = (id: string) => (id === 'index' ? '/' : `/${id}/`);
export const postUrl = (id: string) => `/news/${id}/`;

export interface NavItem {
  title: string;
  href: string;
  order: number;
  children: NavItem[];
}

/**
 * Главное меню: страницы с menu: true + extraNav из site.config, по order.
 * Вложенность — по пути: poleznye-materialy/kalendar становится подпунктом poleznye-materialy,
 * если родитель тоже в меню (иначе — пункт верхнего уровня).
 */
export async function getMenu(): Promise<NavItem[]> {
  const pages = await getPages();
  const flat = pages
    .filter((p) => p.data.menu && p.id !== 'index')
    .map((p) => ({ id: p.id, title: p.data.title, href: pageUrl(p.id), order: p.data.order ?? 100, children: [] as NavItem[] }));
  const byId = new Map(flat.map((n) => [n.id, n]));
  const top: NavItem[] = [];
  for (const n of flat) {
    const parts = n.id.split('/');
    let parent: NavItem | undefined;
    for (let i = parts.length - 1; i > 0 && !parent; i--) parent = byId.get(parts.slice(0, i).join('/'));
    (parent ? parent.children : top).push(n);
  }
  top.push(...SITE.extraNav.map((n) => ({ ...n, children: [] as NavItem[] })));
  const sort = (items: NavItem[]) => {
    items.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru'));
    items.forEach((i) => sort(i.children));
    return items;
  };
  return sort(top);
}

export interface Crumb {
  title: string;
  href?: string;
}

/** Хлебные крошки для вложенной страницы: родители ищутся по префиксу id. */
export function pageCrumbs(page: Page, all: Page[]): Crumb[] {
  const parts = page.id.split('/');
  const crumbs: Crumb[] = [{ title: 'Главная', href: '/' }];
  for (let i = 1; i < parts.length; i++) {
    const parentId = parts.slice(0, i).join('/');
    const parent = all.find((p) => p.id === parentId);
    if (parent) crumbs.push({ title: parent.data.title, href: pageUrl(parent.id) });
  }
  crumbs.push({ title: page.data.title });
  return crumbs;
}
