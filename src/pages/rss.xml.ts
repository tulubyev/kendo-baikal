import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts, postUrl } from '../lib/content';
import { SITE } from '../site.config';

export async function GET(context: APIContext) {
  const posts = (await getPosts()).slice(0, SITE.rssLimit);
  return rss({
    title: `${SITE.name} — новости`,
    description: SITE.description,
    site: context.site!,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.date,
      link: postUrl(p.id),
      categories: [...(p.data.category ? [p.data.category] : []), ...p.data.tags],
    })),
    customData: '<language>ru</language>',
  });
}
