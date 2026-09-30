// Движение из JS: всё, что не решается одним CSS. Длительности и кривые — токены index.css.

import { flushSync } from 'react-dom';

const REDUCED = '(prefers-reduced-motion: reduce)';

/** Пользователь просил меньше движения. Без matchMedia (тесты, старые движки) — не просил. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches;

/** Для scrollIntoView/scrollTo: плавно — только если движение не отключено. */
export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth');

/**
 * Смена вида, которая не является переходом по маршруту (список ↔ пост на телефоне,
 * раскрытие панели): старое состояние гаснет, новое входит — как между страницами.
 *
 * Обновление React выполняется синхронно (flushSync) внутри колбэка перехода: браузер
 * снимает «после» сразу по его завершении. Без поддержки View Transitions или при
 * prefers-reduced-motion — просто обновление, без анимации.
 */
export const startViewTransition = (update: () => void): void => {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function' || prefersReducedMotion()) {
    update();
    return;
  }
  document.startViewTransition(() => {
    flushSync(update);
  });
};
