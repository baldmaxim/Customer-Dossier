import { describe, expect, it } from 'vitest';

import { splitLinks } from './linkify';

describe('splitLinks', () => {
  it('выделяет http и https, текст вокруг сохраняет', () => {
    expect(splitLinks('Подробнее: https://t.me/stroy/5 и http://example.ru.')).toEqual([
      { kind: 'text', text: 'Подробнее: ' },
      { kind: 'link', text: 'https://t.me/stroy/5', href: 'https://t.me/stroy/5' },
      { kind: 'text', text: ' и ' },
      { kind: 'link', text: 'http://example.ru', href: 'http://example.ru' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('другие схемы остаются текстом', () => {
    expect(splitLinks('javascript:alert(1) ftp://x.ru')).toEqual([{ kind: 'text', text: 'javascript:alert(1) ftp://x.ru' }]);
  });

  it('скобка внутри адреса остаётся, закрывающая предложение — нет', () => {
    const [, link] = splitLinks('см. https://ru.wikipedia.org/wiki/Мост_(значения)');
    expect(link).toEqual({ kind: 'link', text: 'https://ru.wikipedia.org/wiki/Мост_(значения)', href: 'https://ru.wikipedia.org/wiki/Мост_(значения)' });
    expect(splitLinks('(https://t.me/a/1)')[1]).toEqual({ kind: 'link', text: 'https://t.me/a/1', href: 'https://t.me/a/1' });
  });

  it('ёлочки не входят в адрес, пустой протокол — не ссылка', () => {
    expect(splitLinks('«https://site.ru/a»')[1]).toMatchObject({ href: 'https://site.ru/a' });
    expect(splitLinks('https://')).toEqual([{ kind: 'text', text: 'https://' }]);
  });
});
