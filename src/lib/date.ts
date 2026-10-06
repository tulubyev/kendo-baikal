const TZ = 'Asia/Irkutsk';

const long = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });

/** «5 октября 2026 г.» → без «г.» для компактности: «5 октября 2026» */
export const formatDate = (d: Date) => long.format(d).replace(/\s?г\.$/, '');

/** Для атрибута <time datetime>, YYYY-MM-DD в часовом поясе клуба */
export const isoDate = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(d);

const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', timeZone: TZ });
const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: TZ });
const yearFmt = new Intl.DateTimeFormat('ru-RU', { year: 'numeric', timeZone: TZ });

/** Части даты для плашки: «02», «Декабрь» (именительный, с заглавной), «2024» */
export function dateParts(d: Date) {
  const m = monthFmt.format(d);
  return { day: dayFmt.format(d), month: m.charAt(0).toUpperCase() + m.slice(1), year: yearFmt.format(d) };
}
