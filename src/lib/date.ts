const TZ = 'Asia/Irkutsk';

const long = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });

/** «5 октября 2026 г.» → без «г.» для компактности: «5 октября 2026» */
export const formatDate = (d: Date) => long.format(d).replace(/\s?г\.$/, '');

/** Для атрибута <time datetime>, YYYY-MM-DD в часовом поясе клуба */
export const isoDate = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(d);
