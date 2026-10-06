// Картинки публикации Telegram — сжатые копии с портала (/api/items/:id/images/:n), а не ссылки на CDN
// Telegram: браузер читателя к третьим сайтам не ходит. Раскладка — как альбом в Telegram: одна картинка во
// всю ширину пузыря, несколько — сеткой по два, при нечётном числе первая на всю строку.
// Фото открывается копией в новой вкладке, обложка видео — постом в оригинале (самого видео на портале нет).

import { FC, useState } from 'react';

import type { IPostImage } from '../../api/types';
import styles from './PostImages.module.css';

interface IPostImagesProps {
  itemId: number;
  images: IPostImage[];
  /** Пост в оригинале: туда ведёт обложка видео. */
  postUrl: string | null;
}

interface IImageProps {
  itemId: number;
  image: IPostImage;
  index: number;
  total: number;
  postUrl: string | null;
  wide: boolean;
}

const PostImage: FC<IImageProps> = ({ itemId, image, index, total, postUrl, wide }) => {
  const [failed, setFailed] = useState(false);
  const src = `/api/items/${itemId}/images/${image.n}`;
  const isVideo = image.kind === 'video';
  const ordinal = total > 1 ? ` ${index + 1} из ${total}` : '';
  const cellClass = `${styles.cell} ${wide ? styles.wide : ''}`;

  if (failed) {
    return <div className={`${cellClass} ${styles.failed}`}>{isVideo ? 'Обложка видео' : 'Фото'} не загрузилось</div>;
  }
  const href = isVideo ? postUrl : src;
  const img = (
    <img
      className={styles.img}
      src={src}
      width={image.width}
      height={image.height}
      alt={isVideo ? `Обложка видео${ordinal}` : `Фото${ordinal}`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
  return (
    <div className={cellClass}>
      {href ? (
        <a
          className={styles.link}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={isVideo ? `Видео${ordinal} — открыть в оригинале` : `Фото${ordinal} — открыть крупнее`}
        >
          {img}
        </a>
      ) : (
        img
      )}
      {isVideo && <span className={styles.badge}>видео</span>}
    </div>
  );
};

export const PostImages: FC<IPostImagesProps> = ({ itemId, images, postUrl }) => {
  if (images.length === 0) return null;
  const single = images.length === 1;
  return (
    <div className={`${styles.album} ${single ? styles.single : ''}`}>
      {images.map((image, index) => (
        <PostImage
          key={image.n}
          itemId={itemId}
          image={image}
          index={index}
          total={images.length}
          postUrl={postUrl}
          wide={!single && images.length % 2 === 1 && index === 0}
        />
      ))}
    </div>
  );
};
