import { useEffect } from 'react';

/** Имя портала — как в <title> index.html и в манифесте. */
export const APP_TITLE = 'Досье Заказчика';

/** «<страница> — Досье Заказчика»; без названия — только имя портала. */
export const formatPageTitle = (title: string | null | undefined): string => {
  const trimmed = title?.trim();
  return trimmed ? `${trimmed} — ${APP_TITLE}` : APP_TITLE;
};

/**
 * Заголовок вкладки браузера. Без него все вкладки назывались «Досье Заказчика», а диктор
 * после перехода не узнавал, где оказался. PageHeader ставит его сам из строкового title.
 *
 * При уходе со страницы заголовок сбрасывается к имени портала: страница, которая свой
 * не ставит, не унаследует чужой.
 */
export const usePageTitle = (title: string | null | undefined): void => {
  useEffect(() => {
    document.title = formatPageTitle(title);
  }, [title]);

  useEffect(
    () => () => {
      document.title = APP_TITLE;
    },
    [],
  );
};
