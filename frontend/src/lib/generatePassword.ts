// Пароль для выдачи пользователю. Без похожих символов (0/O, 1/l/I): его диктуют или
// переписывают с экрана. 14 символов из 55 — около 80 бит.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export const generatePassword = (length = 14): string => {
  const out: string[] = [];
  // Отбраковка вместо остатка от деления: иначе первые символы алфавита выпадали бы чаще.
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit && out.length < length) out.push(ALPHABET[b % ALPHABET.length] ?? '');
    }
  }
  return out.join('');
};
