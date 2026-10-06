/** Что означают популярные плагины WordPress для нового сайта на Astro. */

const T = {
  forms: 'Формы',
  gallery: 'Галереи',
  calendar: 'Календарь/события',
  seo: 'SEO',
  slider: 'Слайдеры',
  shop: 'Магазин',
  builder: 'Конструктор страниц',
  cache: 'Кэш/производительность',
  security: 'Безопасность',
  analytics: 'Аналитика',
  lang: 'Мультиязычность',
  member: 'Пользователи/доступ',
  misc: 'Прочее',
  none: 'Не требуется',
  mail: 'Рассылки',
  social: 'Соцсети',
  table: 'Таблицы',
};

const RULES = [
  [/^contact-form-7$/, T.forms, 'Формы Contact Form 7', 'Статический сайт не обрабатывает формы. Нужен внешний сервис (Formspree, Web3Forms, Getform) или Telegram-бот/почтовый скрипт; либо заменить формы на контакты/ссылки.'],
  [/^(wpforms|wpforms-lite|ninja-forms|formidable|forminator|fluentform|gravityforms|caldera-forms|everest-forms|visual-form-builder)/, T.forms, 'Конструктор форм', 'Форма не переносится — см. «найденные формы». Решение: внешний сервис форм или e-mail ссылка.'],
  [/^(yoast|wordpress-seo|all-in-one-seo|rank-math|seo-by-rank-math|the-seo-framework|wp-seopress|seopress)/, T.seo, 'SEO-плагин', 'Title/description переносятся в frontmatter (title, description). Sitemap и robots.txt Astro-сайт генерирует сам (@astrojs/sitemap).'],
  [/^(nextgen-gallery|envira-gallery|foogallery|modula|photo-gallery|gallery|wp-photo-album|justified-image-grid|responsive-lightbox|final-tiles-grid-gallery|nggallery)/, T.gallery, 'Галерея', 'Галереи из шорткодов [gallery] конвертируются в набор изображений. Сложные галереи плагина (альбомы, lightbox) — проверить вручную.'],
  [/^(the-events-calendar|events-manager|modern-events-calendar|event-organiser|simple-calendar|google-calendar-events|all-in-one-event-calendar|calendar|tribe)/, T.calendar, 'События/календарь', 'События — отдельный тип записей (в отчёте). Для Astro: коллекция events или встроенный Google Calendar (iframe).'],
  [/^(revslider|slider-revolution|smart-slider-3|metaslider|ml-slider|layerslider|soliloquy|master-slider|wp-slick-slider|slider-wd)/, T.slider, 'Слайдер', 'Слайдер не переносится. На главной обычно достаточно hero-блока или лёгкого CSS-слайдера; изображения слайдов проверьте в wp-content/uploads.'],
  [/^(woocommerce|easy-digital-downloads|wp-e-commerce|ecwid|shopify|jigoshop)/, T.shop, 'Магазин', 'Магазин на статическом сайте не работает. Товары не экспортируются; выбрать внешний сервис (Ecwid, Tilda, ЮKassa-ссылки) или отдельное решение.'],
  [/^(elementor|elementor-pro|js_composer|wpbakery|beaver-builder|divi-builder|siteorigin-panels|fusion-builder|oxygen|brizy|visual-composer|so-page-builder|kingcomposer|themify-builder)/, T.builder, 'Конструктор страниц', 'Вёрстка конструктора не переносится 1:1: текст и картинки извлекаются, но макет придётся собрать заново в Astro. Страницы в «ручном списке».'],
  [/^(wp-super-cache|w3-total-cache|wp-rocket|litespeed-cache|wp-fastest-cache|autoptimize|cache-enabler|hummingbird|sg-cachepress|wp-optimize|perfmatters|a3-lazy-load|jetpack-boost|smush|wp-smushit|ewww-image-optimizer|imagify|shortpixel)/, T.cache, 'Кэш/оптимизация', 'Не нужен: Astro собирает статический сайт.'],
  [/^(wordfence|sucuri|all-in-one-wp-security|ithemes-security|better-wp-security|akismet|antispam-bee|recaptcha|google-captcha|really-simple-captcha|limit-login|loginizer|updraftplus|backwpup|duplicator|all-in-one-wp-migration|backupbuddy|wp-mail-smtp|post-smtp|easy-wp-smtp|disable-comments|classic-editor|gutenberg|health-check|query-monitor|wp-crontrol|duplicate-post|regenerate-thumbnails|really-simple-ssl|ssl-insecure-content-fixer|redirection|safe-redirect-manager|wp-migrate-db|user-role-editor|members)/, T.none, 'Служебный плагин', 'Не нужен на статическом сайте (безопасность/резервные копии/редактор).'],
  [/^(google-analytics|monsterinsights|google-site-kit|ga-google-analytics|wp-statistics|google-analytics-dashboard|yandex-metrica|metrika|matomo|cookie-law-info|cookie-notice|complianz|gdpr-cookie-compliance|gtm4wp|duracelltomi-google-tag-manager|insert-headers-and-footers|header-footer|custom-css-js)/, T.analytics, 'Аналитика/метки/cookie', 'Счётчики (Яндекс.Метрика, GA) нужно подключить вручную в layout Astro. Баннер cookie — по необходимости.'],
  [/^(polylang|wpml|sitepress-multilingual-cms|translatepress|weglot|qtranslate)/, T.lang, 'Мультиязычность', 'По плану сайт только на русском; другие языки не экспортируются.'],
  [/^(buddypress|bbpress|ultimate-member|userpro|profile-builder|paid-memberships-pro|memberpress|restrict-content|s2member|wp-members|simple-membership|learndash|lifterlms|tutor|sensei)/, T.member, 'Пользователи/членство/курсы', 'Динамическая часть (вход, закрытые разделы, курсы) на статике не работает. Закрытый контент не экспортируется.'],
  [/^(mailchimp|mc4wp|newsletter|mailpoet|sendinblue|brevo|wysija|subscribe2|email-subscribers)/, T.mail, 'Рассылки', 'Форму подписки нужно заменить на внешний embed сервиса рассылок.'],
  [/^(tablepress|wp-table-reloaded|ninja-tables|data-tables-generator|visualizer)/, T.table, 'Таблицы', 'Таблицы конвертируются в Markdown-таблицы (простые). Проверьте сложные таблицы вручную.'],
  [/^(addtoany|shareaholic|sharethis|social-warfare|ultimate-social-media|simple-social-icons|wp-social|feed-them-social|instagram-feed|smash-balloon|custom-facebook-feed|facebook|vk|social-networks-auto-poster)/, T.social, 'Соцсети', 'Кнопки «поделиться» и ленты соцсетей — отдельные виджеты/embed; ленту Instagram/VK нужно подключить заново.'],
  [/^(wp-polls|wp-postviews|wp-pagenavi|breadcrumb|breadcrumb-navxt|table-of-contents-plus|easy-table-of-contents|related-posts|yet-another-related-posts-plugin|contextual-related-posts|popular-posts|wordpress-popular-posts|advanced-custom-fields|acf|custom-post-type-ui|pods|toolset|meta-box|cmb2)/, T.misc, 'Расширение контента', 'Поля ACF/CPT и подобное в Markdown не переносятся автоматически — проверить, где используются.'],
  [/^(wp-google-maps|google-maps|maps-builder|leaflet-maps-marker|mappress|ultimate-maps|wp-yandex-maps|yandex-maps)/, T.misc, 'Карты', 'Карта заменяется iframe (Яндекс/Google) — найденные карты перечислены в отчёте.'],
];

export function describePlugin(dirOrFile) {
  const slug = String(dirOrFile).split('/')[0].replace(/\.php$/, '').toLowerCase();
  for (const [re, category, name, advice] of RULES) {
    if (re.test(slug)) return { slug, category, name, advice };
  }
  return { slug, category: 'Неизвестно', name: slug, advice: 'Плагин не в списке известных — выясните, что он делает на сайте, и нужна ли эта функция в Astro.' };
}

export const CATEGORIES = T;
