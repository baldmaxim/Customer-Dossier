// Фото объекта с ДОМ.РФ: картинка с портала (/api/projects/:id/photo), а не ссылка на сайт — браузер
// читателя не ходит к третьим сайтам. Не загрузилось (снимка нет, сеть) — вместо него fallback (на карточке —
// заглушка того же размера, чтобы сетка не прыгала), без него — ничего.
// Подпись источника — у того, кто показывает фото: на карточке объекта и в паспорте она своя.

import { FC, ReactNode, useState } from 'react';

interface IObjectPhotoProps {
  projectId: number;
  name: string;
  className?: string;
  /** Карточки в сетке — лениво; паспорт объекта виден сразу. */
  eager?: boolean;
  /**
   * Карточка в сетке — уменьшенная WebP-копия 640 px (07.10.2026): снимок 1280 px на карточке ~320 px весил
   * в 5–10 раз больше, чем показывал. Паспорт объекта — снимок как есть.
   */
  thumb?: boolean;
  /** Что показать, если снимок не загрузился. */
  fallback?: ReactNode;
}

export const ObjectPhoto: FC<IObjectPhotoProps> = ({ projectId, name, className, eager = false, thumb = false, fallback = null }) => {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      className={className}
      src={`/api/projects/${projectId}/photo${thumb ? '?w=640' : ''}`}
      alt={`Фото: ${name}`}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
};
