// Ловля машинных ключей, уходящих на экран без словаря.
//
//   npm run check:labels
//
// На карточке запуска оператор видел `company_mentioned` и `project_mentioned`
// как есть. Такие места появляются не от невнимательности, а оттого, что поле
// приходит строкой и печатается напрямую — глазами это не отлавливается.
//
// Проверка намеренно грубая: ищется вывод поля со «значимым» именем в текстовой
// позиции. Ложное срабатывание снимается маркером /* raw-ok */ в той же строке —
// когда сервер прислал готовую прозу, а не ключ.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

/** Поля, значения которых — машинные перечисления, а не текст для человека. */
const FIELDS = [
  'predicate',
  'status',
  'outcome',
  'verdict',
  'stance',
  'polarity',
  'modality',
  'precision',
  'sentiment',
  'completeness',
  'decision',
  'action',
  'identityStatus',
];

const FIELD_RE = new RegExp(String.raw`\{\s*[\w.?]+\.(${FIELDS.join('|')})\s*\}`);
const TEMPLATE_RE = new RegExp(String.raw`\$\{\s*[\w.?]+\.(${FIELDS.join('|')})\s*\}`);

/** Служебные позиции: пользователь этого не читает. */
const TECHNICAL = [
  /\bkey=/,
  /\bclassName=/,
  /\bvalue=/,
  /\bid=/,
  /\bhtmlFor=/,
  /\baria-[a-z]+=/,
  /\bstyles\[/,
  /queryKey/,
  /^const key =/,
];

const walk = dir =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const files = walk(SRC).filter(f => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));
const problems = [];

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!FIELD_RE.test(line) && !TEMPLATE_RE.test(line)) return;
    // Словарь, компонент Term или явная пометка — значение уже объяснено.
    if (line.includes('_LABELS[') || line.includes('<Term') || line.includes('/* raw-ok */')) return;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (TECHNICAL.some(re => re.test(trimmed))) return;
    problems.push(`${path.relative(ROOT, file)}:${i + 1}: ${trimmed}`);
  });
}

if (problems.length > 0) {
  console.error('[check:labels] машинные значения уходят на экран без подписи:');
  for (const p of problems) console.error(`  ${p}`);
  console.error('Подпись берётся из src/lib/labels.ts (<Term> или X_LABELS[value] ?? value).');
  console.error('Если сервер прислал готовую фразу, пометьте строку /* raw-ok */.');
  process.exit(1);
}

console.log(`[check:labels] ok: проверено файлов ${files.length}, сырых машинных значений не найдено`);
