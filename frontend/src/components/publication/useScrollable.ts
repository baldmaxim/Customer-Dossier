// Прокручивается ли блок по вертикали сейчас. Прокручиваемую область с одним текстом с
// клавиатуры иначе не пролистать (axe scrollable-region-focusable): такой области нужен
// tabIndex=0. Лишняя остановка Tab там, где прокрутки нет (телефон, пост во всю высоту), не нужна.

import { RefObject, useEffect, useState } from 'react';

export const useScrollable = (ref: RefObject<HTMLElement | null>): boolean => {
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (): void => setScrollable(el.scrollHeight - el.clientHeight > 1);
    measure();
    // Размер окна меняет высоту блока, пришедший текст — высоту содержимого: следим за обоими.
    // Без ResizeObserver (jsdom, старые движки) — только замер при изменении содержимого.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resize?.observe(el);
    const mutation = new MutationObserver(measure);
    mutation.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      resize?.disconnect();
      mutation.disconnect();
    };
  }, [ref]);

  return scrollable;
};
