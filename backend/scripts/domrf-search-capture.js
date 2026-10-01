// Выполнять в контексте открытой страницы поиска единого реестра застройщиков наш.дом.рф
// (`/сервисы/единый-реестр-застройщиков?search=…`, этап 20D). Только чтение видимого DOM:
// ссылки на страницы застройщиков и групп компаний в порядке выдачи.
(() => {
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const pathOf = href => {
    try { return decodeURIComponent(new URL(href).pathname); } catch { return ''; }
  };
  const results = [];
  const seen = new Set();
  for (const anchor of document.querySelectorAll('a')) {
    const match = /\/единый-реестр-застройщиков\/(застройщик|группа-компаний)\/(\d{1,18})\/?$/.exec(pathOf(anchor.href));
    if (!match) continue;
    const key = `${match[1]}:${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ kind: match[1] === 'застройщик' ? 'developer' : 'group', ref: match[2], name: clean(anchor.innerText).slice(0, 300) || null });
  }
  return { format: 'domrf-search-browser@1', url: location.href, results };
})()
