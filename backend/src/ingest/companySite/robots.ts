// robots.txt сайта компании (этап 25B): портал читает сайт не по договорённости с ним, а как обычный посетитель,
// поэтому запрет в robots.txt соблюдается. Группы «*» и нашего токена User-agent; правило — самый длинный
// совпавший префикс, при равной длине Allow главнее. Файла нет или он не прочитался — запретов нет.

export interface IRobotsRules {
  allow: string[];
  disallow: string[];
}

export const NO_RULES: IRobotsRules = { allow: [], disallow: [] };

/** Токен нашего User-agent: первое слово до «/» («TG_Info/1.0 (+…)» → «tg_info»). */
export const agentToken = (userAgent: string): string => (userAgent.trim().split(/[\s/]/)[0] ?? '').toLowerCase();

/**
 * Правила для нас: группа с нашим токеном, если она есть, иначе «*». Подряд идущие User-agent — одна группа.
 */
export const parseRobots = (text: string, userAgent: string): IRobotsRules => {
  const token = agentToken(userAgent);
  const groups: Array<{ agents: string[]; rules: IRobotsRules }> = [];
  let current: { agents: string[]; rules: IRobotsRules } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    // Пустой Disallow — «можно всё»: правила не добавляет.
    if (field === 'disallow' && value !== '') current.rules.disallow.push(value);
    if (field === 'allow' && value !== '') current.rules.allow.push(value);
  }
  const own = groups.filter(g => token !== '' && g.agents.some(a => a !== '*' && token.startsWith(a)));
  const chosen = own.length > 0 ? own : groups.filter(g => g.agents.includes('*'));
  return chosen.reduce<IRobotsRules>(
    (acc, g) => ({ allow: [...acc.allow, ...g.rules.allow], disallow: [...acc.disallow, ...g.rules.disallow] }),
    { allow: [], disallow: [] },
  );
};

/** Префикс правила с «*» и «$» (как у поисковиков) — в регулярное выражение от начала пути. */
const ruleMatches = (rule: string, path: string): boolean => {
  const anchored = rule.endsWith('$');
  const body = (anchored ? rule.slice(0, -1) : rule).split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
};

/** Можно ли читать путь (с запросом): самый длинный совпавший префикс решает, при равенстве — Allow. */
export const robotsAllows = (rules: IRobotsRules, pathWithQuery: string): boolean => {
  const longest = (list: string[]): number => list.filter(r => ruleMatches(r, pathWithQuery)).reduce((max, r) => Math.max(max, r.length), -1);
  const deny = longest(rules.disallow);
  if (deny < 0) return true;
  return longest(rules.allow) >= deny;
};
