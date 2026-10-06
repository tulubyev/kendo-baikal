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
}

/** Главное меню: страницы с menu: true + extraNav из site.config, по order. */
export async function getMenu(): Promise<NavItem[]> {
  const pages = await getPages();
  const items: NavItem[] = pages
    .filter((p) => p.data.menu && p.id !== 'index')
    .map((p) => ({ title: p.data.title, href: pageUrl(p.id), order: p.data.order ?? 100 }));
  items.push(...SITE.extraNav.map((n) => ({ ...n })));
  return items.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru'));
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
