// Картинки страницы сайта компании без сети: og:image, ленивые атрибуты, srcset, фон блока, подпись карточки;
// чужой хост, значки, SVG и мелочь — не фото.

import { describe, expect, it } from 'vitest';

import { captionOf, CAPTION_MAX, pageImages, pickFromSrcset, resolveImageUrl } from './images.js';
import type { ISourceNetworkPolicy } from '../../net/safeFetch.js';

const POLICY: ISourceNetworkPolicy = { allowedHosts: ['demo.ru'], allowSubdomains: true, maxBytes: 1_000_000, timeoutMs: 1000, maxRedirects: 3 };
const PAGE = 'https://demo.ru/projects/';

describe('адрес картинки', () => {
  it('относительный — от страницы; поддомен сайта — да; чужой хост, data:, SVG и логотип — нет', () => {
    expect(resolveImageUrl('/upload/a.jpg', PAGE, POLICY)).toBe('https://demo.ru/upload/a.jpg');
    expect(resolveImageUrl('b.jpg#x', PAGE, POLICY)).toBe('https://demo.ru/projects/b.jpg');
    expect(resolveImageUrl('https://cdn.demo.ru/c.webp', PAGE, POLICY)).toBe('https://cdn.demo.ru/c.webp');
    expect(resolveImageUrl('https://static.tildacdn.com/c.jpg', PAGE, POLICY)).toBeNull();
    expect(resolveImageUrl('data:image/png;base64,AAAA', PAGE, POLICY)).toBeNull();
    expect(resolveImageUrl('/img/plan.svg', PAGE, POLICY)).toBeNull();
    expect(resolveImageUrl('/img/logo-white.png', PAGE, POLICY)).toBeNull();
    expect(resolveImageUrl('', PAGE, POLICY)).toBeNull();
  });

  it('srcset: самый крупный до 1600w, иначе самый мелкий; без пометок — первый', () => {
    expect(pickFromSrcset('a.jpg 480w, b.jpg 1200w, c.jpg 2400w')).toBe('b.jpg');
    expect(pickFromSrcset('a.jpg 2000w, b.jpg 3000w')).toBe('a.jpg');
    expect(pickFromSrcset('a.jpg 1x, b.jpg 2x, c.jpg 3x')).toBe('b.jpg');
    expect(pickFromSrcset('a.jpg, b.jpg')).toBe('a.jpg');
    expect(pickFromSrcset(undefined)).toBeUndefined();
  });

  it('подпись — первый непустой блок; блок длиннее предела или с другой картинкой — подписи нет', () => {
    expect(captionOf(['', 'ЖК Остров', 'весь раздел'])).toBe('ЖК Остров');
    expect(captionOf(['', 'я'.repeat(CAPTION_MAX + 1), 'ЖК Остров'])).toBe('');
    expect(captionOf(['', null, 'ЖК Остров'])).toBe('');
    expect(captionOf([])).toBe('');
  });
});

describe('картинки страницы', () => {
  const html = `<html><head>
      <meta property="og:image" content="/upload/og-ostrov.jpg">
    </head><body>
      <header><img src="/img/logo.png" alt="Демо"><img src="/img/menu.jpg" width="24" height="24"></header>
      <div class="cards">
        <div class="card"><a href="/zhk/ostrov"><img src="/img/blank.gif" data-src="/upload/ostrov.jpg" alt=""></a>
          <div class="title">ЖК «Остров»</div><div>Москва, сдача 2027</div></div>
        <div class="card"><picture><source srcset="/upload/bereg-800.webp 800w, /upload/bereg-1600.webp 1600w">
          <img alt="Квартал Берег"></picture></div>
        <div class="card" style="background-image: url('/upload/simvol.jpg')"><span>Символ</span></div>
        <div class="card"><img src="https://static.tildacdn.com/x.jpg"><span>Чужой</span></div>
        <div class="card"><img src="/upload/ostrov.jpg"><span>Дубль</span></div>
      </div>
      <section><img src="/upload/hero.jpg"><p>${'Описание компании. '.repeat(30)}</p></section>
      <script>var img = "<img src='/upload/script.jpg'>";</script>
    </body></html>`;

  it('og:image, карточки с подписью и alt, фон блока; логотип, значок, чужой хост и дубль — нет', () => {
    const page = pageImages(html, PAGE, POLICY, false);
    expect(page).toMatchObject({ url: PAGE, home: false, og: 'https://demo.ru/upload/og-ostrov.jpg' });
    expect(page.images).toEqual([
      { url: 'https://demo.ru/upload/ostrov.jpg', alt: '', caption: 'ЖК «Остров» Москва, сдача 2027' },
      { url: 'https://demo.ru/upload/bereg-1600.webp', alt: 'Квартал Берег', caption: '' },
      { url: 'https://demo.ru/upload/simvol.jpg', alt: '', caption: 'Символ' },
      { url: 'https://demo.ru/upload/hero.jpg', alt: '', caption: '' },
    ]);
  });

  it('og:image логотипом — нет og; запасной — link rel=image_src', () => {
    const logo = pageImages('<html><head><meta property="og:image" content="/logo.png"></head><body></body></html>', PAGE, POLICY, true);
    expect(logo.og).toBeNull();
    const link = pageImages('<html><head><link rel="image_src" href="/upload/x.jpg"></head><body></body></html>', PAGE, POLICY, true);
    expect(link.og).toBe('https://demo.ru/upload/x.jpg');
  });
});
