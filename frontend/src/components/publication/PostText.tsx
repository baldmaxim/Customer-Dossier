// Текст поста: переносы строк как у источника, http(s)-адреса — ссылками.
//
// Разметку строит React из частей (lib/linkify.ts): HTML источника не исполняется, другие
// схемы адреса («javascript:») остаются текстом. Ссылка уходит наружу — в новой вкладке и
// без передачи адреса портала (noopener noreferrer).

import { FC } from 'react';

import { splitLinks } from '../../lib/linkify';
import styles from './PostText.module.css';

interface IPostTextProps {
  text: string;
}

export const PostText: FC<IPostTextProps> = ({ text }) => (
  <p className={styles.text}>
    {splitLinks(text).map((part, i) =>
      part.kind === 'link' ? (
        <a key={i} className={styles.link} href={part.href} target="_blank" rel="noopener noreferrer">
          {part.text}
        </a>
      ) : (
        part.text
      ),
    )}
  </p>
);
