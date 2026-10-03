const VIETNAMESE_VARIANTS: Readonly<Record<string, string>> = {
  a: 'aàáạảãâầấậẩẫăằắặẳẵ',
  d: 'dđ',
  e: 'eèéẹẻẽêềếệểễ',
  i: 'iìíịỉĩ',
  o: 'oòóọỏõôồốộổỗơờớợởỡ',
  u: 'uùúụủũưừứựửữ',
  y: 'yỳýỵỷỹ',
};

function escapeRegexChar(value: string): string {
  return value.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
}

function baseCharacter(value: string): string {
  const lower = value.toLowerCase();
  if (lower === 'đ') return 'd';
  return lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Builds a regex pattern that treats Vietnamese diacritics as equivalent.
 * Example: "hà nội", "Hà Nội" and "ha noi" all match both "Ha Noi" and "Hà Nội".
 */
export function buildAccentInsensitivePattern(value: string): string {
  return Array.from(value).map((character) => {
    const base = baseCharacter(character);
    const variants = VIETNAMESE_VARIANTS[base];
    return variants ? `[${variants}]` : escapeRegexChar(character);
  }).join('');
}
