/**
 * Докрутить горизонтальную полосу (вкладки, сегменты) так, чтобы элемент был виден целиком.
 * Только сама полоса: scrollIntoView заодно прокрутил бы и страницу.
 */
export const scrollIntoRow = (row: HTMLElement | null, item: HTMLElement | null | undefined): void => {
  if (!row || !item || row.scrollWidth <= row.clientWidth) return;
  const left = item.offsetLeft - row.offsetLeft;
  const right = left + item.offsetWidth;
  if (left >= row.scrollLeft && right <= row.scrollLeft + row.clientWidth) return;
  row.scrollLeft = Math.max(0, left - (row.clientWidth - item.offsetWidth) / 2);
};
