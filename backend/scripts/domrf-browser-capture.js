// Выполнять в контексте уже открытой браузером карточки объекта.
// Только чтение видимого DOM: ни запросов к API, ни обхода соседних домов.
(() => {
  const text = element => element?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const unique = items => items.filter((value, index) => items.findIndex(other => JSON.stringify(other) === JSON.stringify(value)) === index);
  const paragraphs = [...document.querySelectorAll('p')].map(text);
  const characteristics = unique(
    [...document.querySelectorAll('[class*="CharacteristicsBlock__Row"], [class*="CharacteristicsBlock__Info-"]')]
      .map(element => ({
        label: text(element.querySelector('[class*="__Name"], [class*="__InfoTitle"]')),
        value: text(element.querySelector('h5, p:last-child')),
      }))
      .filter(item => item.label && item.value),
  );
  // У нежилого объекта квартир нет — тогда признак загруженных характеристик «Количество этажей».
  if (!characteristics.some(item => item.label === 'Количество квартир' || item.label === 'Количество этажей')) {
    throw new Error('Сначала раскройте «Все характеристики» и дождитесь загрузки карточки');
  }
  const title = text(document.querySelector('h1'));
  if (!title) throw new Error('Название объекта не найдено');
  const developerLinks = [...document.querySelectorAll('#KN_DEVELOPER h3 a')].map(text);
  // Ссылки на страницы застройщика и группы в едином реестре застройщиков: по ним работник
  // читает реквизиты застройщика и остальные его объекты (этап 20D). Номер — из адреса ссылки.
  const registryRef = kind => {
    for (const anchor of document.querySelectorAll('#KN_DEVELOPER a')) {
      let path = '';
      try { path = decodeURIComponent(new URL(anchor.href).pathname); } catch { continue; }
      const match = new RegExp(`/единый-реестр-застройщиков/${kind}/(\\d{1,18})/?$`).exec(path);
      if (match) return match[1];
    }
    return null;
  };
  const salesText = document.querySelector('#KN_SALES_DYNAMIC')?.innerText || '';
  const sales = [
    { label: 'Продано квартир', value: salesText.match(/Продано\s*(\d+%)/)?.[1] || '' },
    { label: 'Продано квартир, количество', value: salesText.match(/(\d+ квартир из \d+)/)?.[1] || '' },
    { label: 'Средняя цена м², период', value: salesText.match(/Средняя цена м² на (.+? года)/)?.[1] || '' },
  ].filter(item => item.value);

  return {
    format: 'domrf-browser@1',
    url: location.href,
    title,
    address: text(document.querySelector('[class*="Address__AddressWrapper"] h5')) || null,
    status: text(document.querySelector('[class*="HouseStatus__HouseStatusWrapper"]')) || null,
    pricePerSqm: text(document.querySelector('[class*="ObjectInfo__PriceLi"]')).match(/[\d\s]+\s*₽/)?.[0]?.trim() || null,
    declaration: [...document.querySelectorAll('a')].map(text).find(value => value.startsWith('Проектная декларация')) || null,
    projectDate: paragraphs.find(value => value.startsWith('Дата публикации проекта:'))?.replace(/^Дата публикации проекта:\s*/, '') || null,
    contractor: paragraphs.find(value => value.startsWith('Генподрядчики:'))?.replace(/^Генподрядчики:\s*/, '') || null,
    developerRef: registryRef('застройщик'),
    groupRef: registryRef('группа-компаний'),
    developer: developerLinks.length ? {
      name: developerLinks.find(value => !value.startsWith('Группа компаний')) || '',
      group: developerLinks.find(value => value.startsWith('Группа компаний'))?.replace(/^Группа компаний\s*/, '').replace(/^«|»$/g, '') || null,
    } : null,
    characteristics,
    apartmentGroups: unique([...document.querySelectorAll('#KN_APARTMENT_SHOWCASE [class*="FlatGroups__WrapperBase"]')].map(text).filter(Boolean)).slice(0, 10),
    sales,
    informationUpdated: paragraphs.find(value => value.startsWith('Информация обновлена'))?.replace(/^Информация обновлена\s*/, '') || null,
  };
})()
