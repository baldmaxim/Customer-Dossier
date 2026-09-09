// ВНИМАНИЕ: фикстура tme-channel.html воспроизводит разметку t.me/s/ по
// известной структуре, а не скачана с живого Telegram. Тесты проверяют логику
// разбора, но НЕ подтверждают, что селекторы актуальны.
// Перед включением источников сверьтесь с живой страницей:
//   npm run ingest:once -- --probe <канал>
// Команда покажет, сколько узлов нашёл каждый селектор.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
  parseChannelPage,
  isPrivateChannelStub,
  looksLikeLayoutChange,
} from './telegramWeb.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(HERE, '__fixtures__', 'tme-channel.html'), 'utf8');

describe('parseChannelPage', () => {
  const parsed = parseChannelPage(FIXTURE, 'kzbuild');

  it('находит посты с текстом и пропускает пост без текста', () => {
    expect(parsed.posts).toHaveLength(2);
    expect(parsed.posts.map(p => p.postId)).toEqual([1202, 1201]);
  });

  it('отдаёт от новых к старым', () => {
    expect(parsed.posts[0]!.postId).toBeGreaterThan(parsed.posts[1]!.postId);
  });

  it('разбирает external_id и url', () => {
    const post = parsed.posts.find(p => p.postId === 1201)!;
    expect(post.externalId).toBe('kzbuild/1201');
    expect(post.url).toBe('https://t.me/kzbuild/1201');
  });

  it('декодирует html-сущности и сохраняет перевод строки от <br>', () => {
    const post = parsed.posts.find(p => p.postId === 1201)!;
    expect(post.body).toContain('«BI Group»');
    expect(post.body).toContain('ЖК «Астана Тауэр»');
    expect(post.body).toContain('\nДольщики направили обращение');
  });

  it('разбирает дату публикации', () => {
    const post = parsed.posts.find(p => p.postId === 1201)!;
    expect(post.publishedAt?.toISOString()).toBe('2026-09-01T10:15:00.000Z');
  });

  it('определяет канал-первоисточник у репоста', () => {
    const forwarded = parsed.posts.find(p => p.postId === 1202)!;
    expect(forwarded.forwardFrom).toBe('astana_news');
    const own = parsed.posts.find(p => p.postId === 1201)!;
    expect(own.forwardFrom).toBeNull();
  });

  it('считает layout_stats по каждому селектору', () => {
    expect(parsed.layoutStats.wrap).toBe(3);
    expect(parsed.layoutStats.text).toBe(2);
    expect(parsed.layoutStats.forwarded).toBe(1);
  });
});

describe('looksLikeLayoutChange', () => {
  it('молчащий канал (маленькая страница, ноль постов) — не слом вёрстки', () => {
    const parsed = parseChannelPage('<html><body>пусто</body></html>', 'x');
    expect(looksLikeLayoutChange(parsed)).toBe(false);
  });

  it('большая страница без единого wrap — слом вёрстки', () => {
    const big = `<html><body><div class="feed">${'текст '.repeat(3000)}</div></body></html>`;
    const parsed = parseChannelPage(big, 'x');
    expect(parsed.htmlLength).toBeGreaterThan(10_000);
    expect(looksLikeLayoutChange(parsed)).toBe(true);
  });

  it('рабочая страница — не слом', () => {
    expect(looksLikeLayoutChange(parseChannelPage(FIXTURE, 'kzbuild'))).toBe(false);
  });
});

describe('isPrivateChannelStub', () => {
  it('распознаёт заглушку закрытого канала', () => {
    const stub =
      '<html><body><div class="tgme_page_context_link">' +
      'If you have Telegram, you can view and join right away.</div></body></html>';
    expect(isPrivateChannelStub(stub)).toBe(true);
  });

  it('страницу с постами заглушкой не считает', () => {
    expect(isPrivateChannelStub(FIXTURE)).toBe(false);
  });
});
