// Текст со ссылками: адреса http(s) — настоящие ссылки (React-элементы, не HTML-строка: разметка
// источника не исполняется). Разбиение строки — общее с текстом поста (lib/linkify.ts).

import { FC } from 'react';

import { splitLinks } from '../lib/linkify';

export const LinkifiedText: FC<{ text: string }> = ({ text }) => (
  <>
    {splitLinks(text).map((part, i) =>
      part.kind === 'link' ? (
        <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">
          {part.text}
        </a>
      ) : (
        part.text
      ),
    )}
  </>
);
