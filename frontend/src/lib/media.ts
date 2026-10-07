// Брейкпоинты портала для useMediaQuery — те же числа, что в таблице в начале index.css.
// Только min-width, mobile-first: база — 360px, дальше расширяем.

export const MQ = {
  /** 600px: шапка вместо нижней панели, формы в две колонки, таблица вместо карточек. */
  sm: '(min-width: 600px)',
  /** 900px: две колонки, мастер-деталь. */
  md: '(min-width: 900px)',
  /** 1280px: широкие раскладки. */
  lg: '(min-width: 1280px)',
  /** Читалка «в один экран»: широкое и достаточно высокое окно (не телефон боком). */
  reader: '(min-width: 900px) and (min-height: 600px)',
  /** Окно выше телефона боком. sm без tall — телефон боком (в CSS: `(min-width: 600px) and (max-height: 500px)`):
   *  меню полосой слева, фильтры свёрнуты, как на телефоне. Запрос — min-height: без matchMedia окно «высокое». */
  tall: '(min-height: 501px)',
} as const;

export type MediaQueryName = keyof typeof MQ;
