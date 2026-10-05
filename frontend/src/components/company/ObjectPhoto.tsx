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
  /** Что показать, если снимок не загрузился. */
  fallback?: ReactNode;
}

export const ObjectPhoto: FC<IObjectPhotoProps> = ({ projectId, name, className, eager = false, fallback = null }) => {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      className={className}
      src={`/api/projects/${projectId}/photo`}
      alt={`Фото: ${name}`}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
};
