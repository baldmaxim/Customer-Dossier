// Дедупликация постов. Один и тот же текст гуляет по каналам репостами, и
// каждый канал дописывает свою подпись («Подписывайтесь», ссылка на себя,
// хвост хештегов). Если хэшировать сырой текст, LLM будет вызвана на каждую
// копию — это прямая трата GPU и дубли в ленте упоминаний.
//
// Решение: хэш считаем от текста, из которого вычищены следы канала.

import { createHash } from 'node:crypto';

/** Эмодзи и пиктограммы: у разных каналов свои «украшения» вокруг того же текста. */
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}]/gu;

/** Ссылки целиком: t.me/канал, http(s), @упоминания. */
const LINKS = /(https?:\/\/\S+|t\.me\/\S+|@[A-Za-z0-9_]{3,})/g;

/**
 * Подписи канала в хвосте поста. Обязательное условие — начало строки:
 * подпись канала всегда стоит отдельным абзацем. Без этой привязки регексп
 * ловит слово из середины новости («аким призвал ПОДПИСЫВАТЬ акты») и срезает
 * весь остаток текста — разные новости схлопываются в один хэш.
 */
const TAIL_CTA =
  /(?:^|\n)[^\S\n]*(?:подпис|наш канал|наш телеграм|читайте|источник|прислать новость|реклама|erid|связь с редакцией|бот для связи|по вопросам)[\s\S]*$/imu;

/** Хвост из хештегов: #астана #стройка ... в конце поста. */
const TAIL_HASHTAGS = /(?:^|\s)(#[^\s#]+(?:\s+#[^\s#]+)*)\s*$/u;

const COLLAPSE = /\s+/g;

/**
 * Приведение текста к форме, устойчивой к «оформлению» канала.
 * Результат используется ТОЛЬКО для хэша — в БД и в LLM уходит исходный body.
 */
export const normalizeForHash = (body: string): string => {
  let s = body.normalize('NFKC');

  s = s.replace(EMOJI, ' ');
  s = s.replace(LINKS, ' ');

  // Хвостовые хештеги — до CTA: иначе CTA-регексп съест их вместе с текстом.
  s = s.replace(TAIL_HASHTAGS, ' ');
  s = s.replace(TAIL_CTA, ' ');

  // Пунктуация и регистр: «Срыв сроков!» и «Срыв сроков.» — один текст.
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');

  return s.replace(COLLAPSE, ' ').trim().toLowerCase();
};

const sha256 = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

export interface IContentHashes {
  /** Полный хэш нормализованного текста. Первичный ключ дедупликации. */
  contentHash: Buffer;
  /**
   * Хэш первых 200 символов. Ловит перепечатки, где хвост дописали или обрезали,
   * а начало осталось прежним. Не уникальный — только сигнал для ручного разбора.
   */
  leadHash: Buffer;
  /** Длина нормализованного текста: пустые/мусорные посты отсекаем до вставки. */
  normalizedLength: number;
}

export const computeHashes = (body: string): IContentHashes => {
  const normalized = normalizeForHash(body);
  return {
    contentHash: sha256(normalized),
    leadHash: sha256(normalized.slice(0, 200)),
    normalizedLength: normalized.length,
  };
};

/**
 * Минимальная длина осмысленного поста. Ниже — это «👍», стикер или голая
 * ссылка: LLM на таком только выдумает сущности.
 */
export const MIN_BODY_LENGTH = 40;

export const isTooShortToProcess = (body: string): boolean =>
  normalizeForHash(body).length < MIN_BODY_LENGTH;
