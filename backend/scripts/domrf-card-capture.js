// Выполнять в контексте открытой страницы застройщика или группы компаний в едином реестре
// застройщиков наш.дом.рф (этап 20D). Только чтение видимого DOM: ни запросов к API, ни переходов.
// Список объектов раскрывает вызывающий код («Показать ещё») до запуска скрипта.
(() => {
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const lines = document.body.innerText.split('\n').map(clean).filter(Boolean);
  // Реквизит — строка-подпись и значение следующей строкой: «ИНН» / «9729319987».
  const after = label => {
    const index = lines.indexOf(label);
    return index === -1 ? null : lines[index + 1] || null;
  };
  const pathOf = href => {
    try { return decodeURIComponent(new URL(href).pathname); } catch { return ''; }
  };
  const page = /\/единый-реестр-застройщиков\/(застройщик|группа-компаний)\/(\d{1,18})\/?$/.exec(pathOf(location.href));
  const groupAnchor = [...document.querySelectorAll('a')]
    .find(anchor => /\/единый-реестр-застройщиков\/группа-компаний\/\d{1,18}\/?$/.test(pathOf(anchor.href)));

  const objects = [];
  const seen = new Set();
  for (const anchor of document.querySelectorAll('a')) {
    const match = /\/каталог-новостроек\/объект\/(\d{1,18})\/?$/.exec(pathOf(anchor.href));
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    // Карточка списка: «Строится» / «ID: 71431» / «РЕКА» / «г. Москва, Район Раменки» / метро / время.
    const parts = anchor.innerText.split('\n').map(clean).filter(Boolean);
    const idIndex = parts.findIndex(part => /^ID:\s*\d+$/.test(part));
    objects.push({
      ref: match[1],
      status: idIndex > 0 ? parts.slice(0, idIndex).join(' ') : null,
      name: idIndex >= 0 ? parts[idIndex + 1] || null : null,
      place: idIndex >= 0 ? parts[idIndex + 2] || null : null,
    });
  }

  return {
    format: 'domrf-card-browser@1',
    url: location.href,
    kind: page ? (page[1] === 'застройщик' ? 'developer' : 'group') : null,
    externalRef: page ? page[2] : null,
    title: clean(document.querySelector('h1')?.innerText),
    // У группы заголовок страницы — «Группа компаний», а название — в заголовке вкладки: «ДОНСТРОЙ | ЕИСЖС».
    documentTitle: clean(document.title.split('|')[0]),
    inn: after('ИНН'),
    kpp: after('КПП'),
    ogrn: after('ОГРН'),
    legalAddress: after('Юридический адрес'),
    groupRef: groupAnchor ? /\/группа-компаний\/(\d{1,18})\/?$/.exec(pathOf(groupAnchor.href))?.[1] || null : null,
    groupName: groupAnchor ? clean(groupAnchor.innerText).replace(/^Группа компаний\s*/, '').replace(/^«|»$/g, '') || null : null,
    objects,
  };
})()
