// Арифметика графиков: доли, ширина полос, «круглый» верх шкалы. Чистые функции — тестируются
// без DOM. Ни одного нового показателя здесь не считается: только как нарисовать уже посчитанное.

/** Доля значения от знаменателя (0..1); знаменателя нет или он ноль — null («недостаточно данных»). */
export const shareOf = (value: number, total: number | null | undefined): number | null =>
  total !== null && total !== undefined && total > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, value / total)) : null;

/** Длина полосы в процентах от основания (итога или наибольшего значения), с одним знаком. */
export const barPercent = (value: number, base: number): number =>
  base > 0 && value > 0 ? Math.round(Math.min(1, value / base) * 1000) / 10 : 0;

/** Верх шкалы столбиков: ближайшее сверху 1 · 2 · 5 × 10ⁿ, чтобы самый высокий столбик не упирался в край. */
export const niceMax = (max: number): number => {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 5, 10].find(s => s * power >= max) ?? 10;
  return step * power;
};

export interface IMonthPoint {
  /** «YYYY-MM» */
  month: string;
  value: number;
}

/** Самый «высокий» месяц — первый из равных; пустой ряд — null. */
export const peakOf = (points: ReadonlyArray<IMonthPoint>): IMonthPoint | null =>
  points.reduce<IMonthPoint | null>((best, p) => (p.value > (best?.value ?? 0) ? p : best), null);
