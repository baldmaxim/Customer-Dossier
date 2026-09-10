// Разбор лент и извлечение текста статьи — чистые функции, сеть не нужна.
//
// Фикстуры написаны по спецификациям RSS 2.0 и Atom, а не скачаны с живого
// сайта: они проверяют логику разбора, а не то, что конкретное издание сегодня
// отдаёт. Живую ленту сверяйте командой --probe-site.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { parseFeed, looksLikeFeed, extractArticleText } from './website.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  fs.readFileSync(path.join(HERE, '__fixtures__', name), 'utf8');

const RSS = fixture('feed-rss.xml');
const ATOM = fixture('feed-atom.xml');
const ARTICLE = fixture('article.html');

describe('looksLikeFeed', () => {
  it('узнаёт RSS и Atom', () => {
    expect(looksLikeFeed(RSS)).toBe(true);
    expect(looksLikeFeed(ATOM)).toBe(true);
  });

  it('обычную страницу лентой не считает', () => {
    // Иначе при неверном адресе мы бы молча разобрали HTML в ноль записей
    // и решили, что «сайт сегодня ничего не публиковал».
    expect(looksLikeFeed(ARTICLE)).toBe(false);
  });
});

describe('parseFeed — RSS', () => {
  const parsed = parseFeed(RSS, 'https://example.ru');

  it('пропускает запись без ссылки', () => {
    expect(parsed.items).toHaveLength(2);
  });

  it('берёт заголовок и абсолютную ссылку', () => {
    expect(parsed.items[0]!.title).toBe('ПИК сорвал срок сдачи ЖК «Северный»');
    expect(parsed.items[0]!.url).toBe('https://example.ru/news/1');
  });

  it('достраивает относительную ссылку до абсолютной', () => {
    expect(parsed.items[1]!.url).toBe('https://example.ru/news/2');
  });

  it('предпочитает content:encoded короткому description', () => {
    // В description лежит анонс, в content:encoded — полный текст.
    const body = parsed.items[0]!.body;
    expect(body).toContain('на восемь месяцев');
    expect(body).toContain('мэрию Москвы');
  });

  it('снимает html-разметку из тела', () => {
    expect(parsed.items[0]!.body).not.toContain('<p>');
  });

  it('разбирает дату публикации', () => {
    expect(parsed.items[0]!.publishedAt?.toISOString()).toBe('2026-09-01T07:15:00.000Z');
  });

  it('берёт guid как external_id, а при его отсутствии — ссылку', () => {
    expect(parsed.items[0]!.externalId).toBe('news-1');
    expect(parsed.items[1]!.externalId).toBe('https://example.ru/news/2');
  });
});

describe('parseFeed — Atom', () => {
  const parsed = parseFeed(ATOM, 'https://atom.example.ru');

  it('читает записи, где ссылка в атрибуте href', () => {
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]!.url).toBe('https://atom.example.ru/a/100');
    expect(parsed.items[1]!.url).toBe('https://atom.example.ru/a/101');
  });

  it('берёт published, а при его отсутствии — updated', () => {
    expect(parsed.items[0]!.publishedAt?.toISOString()).toBe('2026-09-01T07:30:00.000Z');
    expect(parsed.items[1]!.publishedAt?.toISOString()).toBe('2026-09-02T12:00:00.000Z');
  });

  it('различает формат в статистике разбора', () => {
    expect(parsed.layoutStats.atom_entry).toBe(2);
    expect(parsed.layoutStats.rss_item).toBe(0);
  });
});

describe('extractArticleText', () => {
  const text = extractArticleText(ARTICLE);

  it('берёт тело статьи', () => {
    expect(text).toContain('сорвало срок сдачи жилого комплекса');
    expect(text).toContain('перебоями с поставкой металлоконструкций');
  });

  it('выбрасывает меню, подвал и скрипты', () => {
    // Попав в текст, они портят цитаты и сбивают проверку дословности.
    expect(text).not.toContain('Главная');
    expect(text).not.toContain('© 2026');
    expect(text).not.toContain('счётчик посещений');
  });

  it('не берёт боковую колонку вместо статьи', () => {
    expect(text).not.toContain('Подпишитесь на рассылку');
  });

  it('явный селектор имеет приоритет', () => {
    expect(extractArticleText(ARTICLE, '.content')).toContain('металлоконструкций');
  });

  it('неподходящий селектор не ломает разбор — работает общий алгоритм', () => {
    const fallback = extractArticleText(ARTICLE, '.no-such-class');
    expect(fallback).toContain('сорвало срок сдачи');
  });

  it('на странице без статьи возвращает пустую строку, а не мусор', () => {
    expect(extractArticleText('<html><body><nav>меню</nav></body></html>')).toBe('');
  });
});
