// Выполнять в контексте открытой страницы поиска единого реестра застройщиков наш.дом.рф
// (`/сервисы/единый-реестр-застройщиков?search=…`, этап 20D). Только чтение видимого DOM:
// ссылки на страницы застройщиков и групп компаний в порядке выдачи и строки карточки результата
// рядом с названием (реквизиты, регион) — без знания вёрстки: карточка — самый широкий предок ссылки,
// в котором нет других результатов и не больше 600 знаков текста.
(() => {
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const pathOf = href => {
    try { return decodeURIComponent(new URL(href).pathname); } catch { return ''; }
  };
  const RESULT = /\/единый-реестр-застройщиков\/(застройщик|группа-компаний)\/(\d{1,18})\/?$/;
  const keyOf = anchor => {
    const match = RESULT.exec(pathOf(anchor.href));
    return match ? `${match[1]}:${match[2]}` : null;
  };
  const resultsIn = element => new Set([...element.querySelectorAll('a')].map(keyOf).filter(Boolean));
  const detailsOf = (anchor, name) => {
    let box = anchor;
    while (box.parentElement && box.parentElement !== document.body) {
      const parent = box.parentElement;
      if (resultsIn(parent).size > 1 || clean(parent.innerText).length > 600) break;
      box = parent;
    }
    const lines = (box.innerText || '').split('\n').map(clean).filter(line => line !== '' && line !== name);
    const details = lines.join(' · ').slice(0, 400);
    return details || null;
  };
  const results = [];
  const seen = new Set();
  for (const anchor of document.querySelectorAll('a')) {
    const key = keyOf(anchor);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const [kind, ref] = key.split(':');
    const name = clean(anchor.innerText).slice(0, 300) || null;
    results.push({ kind: kind === 'застройщик' ? 'developer' : 'group', ref, name, details: detailsOf(anchor, name) });
  }
  return { format: 'domrf-search-browser@1', url: location.href, results };
})()
