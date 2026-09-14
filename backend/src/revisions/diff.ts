// Построчный diff двух редакций со строгими пределами. Чистая функция:
// текст только сравнивается как строки — никакого HTML и никаких запросов.

export interface IDiffLimits {
  /** Максимум строк в каждой версии; больше — отказ с причиной. */
  maxLines: number;
  /** Максимум символов в каждой версии. */
  maxChars: number;
  /** Сколько неизменных строк показывать вокруг изменений. */
  context: number;
}

export const DEFAULT_DIFF_LIMITS: IDiffLimits = { maxLines: 2000, maxChars: 200_000, context: 3 };

export type DiffOp =
  | { op: 'equal'; lines: string[] }
  | { op: 'delete'; lines: string[] }
  | { op: 'insert'; lines: string[] }
  | { op: 'skip'; count: number };

export type IDiffResult =
  | { ok: true; ops: DiffOp[]; inserted: number; deleted: number }
  | { ok: false; reason: string };

const push = (ops: DiffOp[], op: 'equal' | 'delete' | 'insert', line: string): void => {
  const last = ops[ops.length - 1];
  if (last && last.op === op) last.lines.push(line);
  else ops.push({ op, lines: [line] });
};

export const diffLines = (before: string, after: string, limits: IDiffLimits = DEFAULT_DIFF_LIMITS): IDiffResult => {
  if (before.length > limits.maxChars || after.length > limits.maxChars) {
    return { ok: false, reason: `текст длиннее ${limits.maxChars} символов` };
  }
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > limits.maxLines || b.length > limits.maxLines) {
    return { ok: false, reason: `больше ${limits.maxLines} строк` };
  }

  // LCS по строкам: O(n·m) при n, m ≤ maxLines, таблица в Uint16/Uint32.
  const n = a.length;
  const m = b.length;
  const table = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number): number => table[i * (m + 1) + j] ?? 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * (m + 1) + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const raw: DiffOp[] = [];
  let i = 0;
  let j = 0;
  let inserted = 0;
  let deleted = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(raw, 'equal', a[i] ?? '');
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      push(raw, 'delete', a[i] ?? '');
      deleted += 1;
      i += 1;
    } else {
      push(raw, 'insert', b[j] ?? '');
      inserted += 1;
      j += 1;
    }
  }
  for (; i < n; i += 1) {
    push(raw, 'delete', a[i] ?? '');
    deleted += 1;
  }
  for (; j < m; j += 1) {
    push(raw, 'insert', b[j] ?? '');
    inserted += 1;
  }

  // Длинные неизменные участки сворачиваются, остаётся контекст вокруг правок.
  const ops: DiffOp[] = [];
  raw.forEach((op, index) => {
    if (op.op !== 'equal' || op.lines.length <= limits.context * 2) {
      ops.push(op);
      return;
    }
    const isFirst = index === 0;
    const isLast = index === raw.length - 1;
    const head = isFirst ? [] : op.lines.slice(0, limits.context);
    const tail = isLast ? [] : op.lines.slice(-limits.context);
    const skipped = op.lines.length - head.length - tail.length;
    if (head.length > 0) ops.push({ op: 'equal', lines: head });
    if (skipped > 0) ops.push({ op: 'skip', count: skipped });
    if (tail.length > 0) ops.push({ op: 'equal', lines: tail });
  });

  return { ok: true, ops, inserted, deleted };
};
