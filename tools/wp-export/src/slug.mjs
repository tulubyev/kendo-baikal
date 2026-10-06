import { decodeSafe } from './util.mjs';

const MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // украинские / бурятские буквы на всякий случай
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ү: 'u', ө: 'o', һ: 'h',
};

export function translit(s) {
  let out = '';
  for (const ch of s.toLowerCase()) out += ch in MAP ? MAP[ch] : ch;
  return out;
}

/**
 * Превращает post_name / заголовок в slug.
 * mode: 'translit' (по умолчанию) — латиница; 'keep' — кириллица сохраняется.
 */
export function slugify(raw, mode = 'translit') {
  let s = decodeSafe(String(raw ?? '')).normalize('NFC').toLowerCase();
  if (mode === 'translit') s = translit(s);
  s = s.replace(mode === 'keep' ? /[^\p{L}\p{N}]+/gu : /[^a-z0-9]+/g, '-');
  return s.replace(/^-+|-+$/g, '').slice(0, 120).replace(/-+$/g, '');
}
