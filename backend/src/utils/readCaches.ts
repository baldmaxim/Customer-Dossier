// Кэши чтения, которые сбрасывает любое изменение через API (07.10.2026): каталог компаний и «Новое» считаются по
// всей базе и одинаковы для всех читателей. app.ts после каждого успешного не-GET запроса зовёт invalidateReadCaches —
// действие оператора видно сразу; изменения фоновых заданий (сбор, разбор, ДОМ.РФ) — не позже срока кэша.

const clears: Array<() => void> = [];

export const registerReadCache = (clear: () => void): void => {
  clears.push(clear);
};

export const invalidateReadCaches = (): void => {
  for (const clear of clears) clear();
};
