// theme-color — один источник: токен --chrome в index.css (им же красятся шапка и нижняя
// панель). Инлайн-скрипт темы в index.html и manifest.json повторяют его литералом — здесь
// проверяется, что копии не разошлись: иначе у системной панели PWA шов с шапкой.

import { describe, expect, it } from 'vitest';

import html from '../../index.html?raw';
import manifestRaw from '../../public/manifest.json?raw';
import css from '../index.css?raw';

const chromeIn = (block: string): string | undefined => /--chrome:\s*(#[0-9a-f]{6})/i.exec(block)?.[1]?.toLowerCase();

const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const darkStart = css.indexOf(":root[data-theme='dark'] {");
const darkBlock = css.slice(darkStart, css.indexOf('}', darkStart));

describe('theme-color', () => {
  const light = chromeIn(lightBlock);
  const dark = chromeIn(darkBlock);

  it('токен --chrome задан в обеих темах', () => {
    expect(light).toMatch(/^#[0-9a-f]{6}$/);
    expect(dark).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('index.html: мета-тег и инлайн-скрипт — те же значения', () => {
    const lower = html.toLowerCase();
    expect(lower).toContain(`<meta name="theme-color" content="${light}"`);
    expect(lower).toContain(`theme === 'dark' ? '${dark}' : '${light}'`);
  });

  it('manifest.json: theme_color — светлый --chrome', () => {
    const manifest = JSON.parse(manifestRaw) as { theme_color: string };
    expect(manifest.theme_color.toLowerCase()).toBe(light);
  });

  it('инлайн-скрипт проверяет сохранённое значение темы', () => {
    expect(html).toContain("stored === 'dark' || stored === 'light'");
  });
});
