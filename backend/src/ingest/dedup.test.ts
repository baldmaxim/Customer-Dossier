import { describe, it, expect } from 'vitest';

import { normalizeForHash, computeHashes, isTooShortToProcess } from './dedup.js';

const POST = 'ТОО «BI Group» сорвало срок сдачи ЖК «Астана Тауэр» на восемь месяцев.';

describe('normalizeForHash', () => {
  it('репост с чужой подписью даёт тот же хэш', () => {
    const original = `🏗 ${POST}\n\n#астана #стройка`;
    const repost = `${POST}\n\nПодписывайтесь на наш канал: https://t.me/some_channel`;
    expect(computeHashes(original).contentHash.equals(computeHashes(repost).contentHash)).toBe(true);
  });

  it('разные эмодзи вокруг одного текста не различают посты', () => {
    expect(normalizeForHash(`🔥🔥 ${POST}`)).toBe(normalizeForHash(`⚡️ ${POST}`));
  });

  it('пунктуация и регистр не различают посты', () => {
    expect(normalizeForHash('Срыв сроков!')).toBe(normalizeForHash('срыв сроков.'));
  });

  it('разные тексты остаются разными', () => {
    const a = computeHashes(POST);
    const b = computeHashes(POST.replace('восемь', 'три'));
    expect(a.contentHash.equals(b.contentHash)).toBe(false);
  });

  it('не режет призыв, если он в середине новости', () => {
    const text = 'Аким призвал подписывать акты только после проверки качества работ на объекте.';
    expect(normalizeForHash(text)).toContain('подписывать акты');
  });

  it('вырезает хвостовые хештеги, но не решётку внутри текста', () => {
    const withTail = `${POST} #астана #стройка`;
    expect(normalizeForHash(withTail)).toBe(normalizeForHash(POST));
  });

  it('вырезает ссылки и @упоминания', () => {
    const withLinks = `${POST} @kzbuild https://example.kz/news/1`;
    expect(normalizeForHash(withLinks)).toBe(normalizeForHash(POST));
  });

  it('вырезает подпись канала, когда она отдельным абзацем', () => {
    const withSignature = `${POST}\nИсточник: @kzbuild\nПо вопросам рекламы — @manager`;
    expect(normalizeForHash(withSignature)).toBe(normalizeForHash(POST));
  });

  it('подпись в той же строке остаётся — и это осознанный размен', () => {
    // Срезать «источник» из середины строки нельзя: тем же движением мы съедаем
    // остаток настоящей новости. Цена — изредка пропущенный дубль (один лишний
    // вызов LLM). Обратная ошибка дороже: две разные новости схлопнутся в одну.
    const inline = `${POST} Источник: пресс-служба`;
    expect(normalizeForHash(inline)).not.toBe(normalizeForHash(POST));
  });
});

describe('leadHash', () => {
  it('совпадает у постов с общим началом и разным хвостом', () => {
    // Общее начало должно быть длиннее окна lead-хэша (200 символов),
    // иначе расхождение попадает внутрь окна и хэши закономерно разойдутся.
    const shared =
      `${POST} Подрядчик объясняет задержку перебоями с поставкой металлоконструкций ` +
      'и пересмотром проектных решений по фасаду, дольщики направили коллективное обращение в акимат города.';
    const a = computeHashes(`${shared} Комментарии сторон приводим ниже.`);
    const b = computeHashes(`${shared} Ответ застройщика ожидается на следующей неделе.`);
    expect(a.leadHash.equals(b.leadHash)).toBe(true);
    expect(a.contentHash.equals(b.contentHash)).toBe(false);
  });
});

describe('isTooShortToProcess', () => {
  it('отсекает реакции, стикеры и голые ссылки', () => {
    expect(isTooShortToProcess('👍')).toBe(true);
    expect(isTooShortToProcess('https://t.me/channel/123')).toBe(true);
    expect(isTooShortToProcess('Отлично!')).toBe(true);
  });

  it('пропускает содержательный пост', () => {
    expect(isTooShortToProcess(POST)).toBe(false);
  });
});
