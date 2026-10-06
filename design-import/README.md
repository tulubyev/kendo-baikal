# design-import

Автоматически собрано инструментом wp-export из активной темы WordPress (ink-and-wash).

- `tokens.json` — цвета, шрифты, размеры, радиусы, ширина контейнера (эвристики по CSS и theme.json).
- `templates.md` / `templates.json` — структура шаблонов темы (header/footer/главная/запись/страница).
- `theme/<тема>/` — CSS темы, шрифты, нужные картинки. PHP не копируется.
- `branding/` — логотип, иконка сайта, favicon (если найдены).
- `screenshots/` — скриншоты настоящего старого сайта (архивные снимки Wayback Machine, 2024–2025; сжаты до 1600 px, WebP): `old-home`, `old-post-list`, `old-pagination-footer` (лента), `old-english`, `old-contacts`, `old-yarmarka`, `old-calendar`, `old-rules-footer` (страницы).

Это материал для переноса дизайна в Astro, не готовые стили: значения нужно проверить глазами.
