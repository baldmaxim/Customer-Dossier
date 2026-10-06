// Строка «Генподрядчики» ДОМ.РФ для показа: «ООО СУ-10 (ИНН: 7736255508)» → «ООО СУ-10».
// ИНН и сопоставление с карточками — на сервере (registry/contractors.ts, «Кто строит для компании»);
// на карточке объекта нужно только имя, без реквизита в скобках.

const INN_MARK = /\s*\(\s*ИНН\s*:?\s*\d{10,12}\s*\)/giu;

export const contractorNames = (text: string | null | undefined): string | null => {
  const names = (text ?? '').replace(INN_MARK, '').replace(/\s+/gu, ' ').trim();
  return names === '' ? null : names;
};
