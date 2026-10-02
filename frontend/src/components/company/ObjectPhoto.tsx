// Фото объекта с ДОМ.РФ: картинка с портала (/api/projects/:id/photo), а не ссылка на сайт — браузер
// читателя не ходит к третьим сайтам. Не загрузилось (снимка нет, сеть) — место под фото не остаётся.
// Подпись источника — у того, кто показывает фото: на карточке объекта и в паспорте она своя.

import { FC, useState } from 'react';

interface IObjectPhotoProps {
  projectId: number;
  name: string;
  className?: string;
  /** Карточки в сетке — лениво; паспорт объекта виден сразу. */
  eager?: boolean;
}

export const ObjectPhoto: FC<IObjectPhotoProps> = ({ projectId, name, className, eager = false }) => {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
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
