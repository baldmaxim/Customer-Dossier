// Экспорт снимка (этап 08B): Markdown, JSON и самодостаточный HTML «Версия для печати». Строится только из payload
// выбранного снимка (после применения текущей доступности), не из текущей базы.
//
// Безопасность: текст источника экранируется; ссылки — только http/https; в HTML нет скриптов и внешних ресурсов
// (CSP default-src 'none'); технический контекст (токены, стек, параметры модели) в payload не попадает.

import type { IStatement } from '../dossier/statements.js';
import type { ISnapshotPayload } from './build.js';
import type { IBriefItem, IBriefSection, INegotiationBrief } from '../dossier/brief.js';

export interface ISnapshotMeta {
  id: number;
  caseId: number;
  payloadHash: string;
  hashAlgorithm: string;
  generatedAt: string;
}

const ATTRIBUTION: Record<string, string> = {
  source_reported: 'в публикации сообщается',
  analyst_reviewed: 'проверено аналитиком',
  analyst_disputed: 'спорно по решению аналитика',
  analyst_rejected: 'отклонено аналитиком',
  operator_claim: 'со слов обратившегося',
  not_established: 'не установлено в выборке',
  system_context: 'контекст',
};

const EDGE: Record<string, string> = {
  participation: 'участие в объекте',
  contract: 'договор (сообщён источником)',
  corporate: 'корпоративная связь',
  hierarchy: 'входит в объект',
  co_mentioned: 'совместное упоминание',
};

const dateOnly = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—');

// ---------------------------------------------------------------------------
// HTML

export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const safeHref = (url: string | null): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};

const htmlStatements = (items: IStatement[], empty: string): string =>
  items.length === 0
    ? `<p class="muted">${escapeHtml(empty)}</p>`
    : `<ul class="statements">${items
        .map(
          s =>
            `<li><span class="attr">${escapeHtml(ATTRIBUTION[s.attribution] ?? s.attribution)}</span> ${escapeHtml(s.text)}${
              s.assertionIds.length ? ` <span class="ids">[утв. ${s.assertionIds.map(id => `#${id}`).join(', ')}${s.evidenceIds.length ? `; док. ${s.evidenceIds.map(id => `#${id}`).join(', ')}` : ''}]</span>` : ''
            }${s.quotes.map(q => `<blockquote>«${escapeHtml(q.quote)}» <span class="ids">${escapeHtml(q.sourceTitle)}, ${escapeHtml(dateOnly(q.publishedAt))}, док. #${q.evidenceId}</span></blockquote>`).join('')}</li>`,
        )
        .join('')}</ul>`;

/** Этап 17: пункт краткого досье — статус словами, текст, область, свежесть, происхождение и ссылки. Одинаковый набор полей во всех форматах. */
export const briefItemLine = (i: IBriefItem): { status: string; text: string; details: string } => ({
  status: i.statusLabel,
  text: i.text,
  details: [
    i.scope ? `область: ${i.scope}` : null,
    i.asOf ? `свежесть: ${i.asOf}` : null,
    i.sources.publications > 0 ? `источники: ${i.sources.label}` : null,
    i.pendingRevision ? 'есть более новая редакция — нужен пересмотр' : null,
    i.assertionIds.length ? `утв. ${i.assertionIds.map(id => `#${id}`).join(', ')}` : null,
    i.evidenceIds.length ? `док. ${i.evidenceIds.map(id => `#${id}`).join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('; '),
});

const htmlBrief = (b: INegotiationBrief | undefined): string => {
  if (!b) return '<p class="muted">Краткое досье в снимке отсутствует (снимок до dossier-template@3).</p>';
  const section = (x: IBriefSection): string =>
    `<h3>${escapeHtml(x.title)}</h3>${
      x.items.length === 0
        ? `<p class="muted">${escapeHtml(x.empty)}</p>`
        : `<ul class="statements">${x.items
            .map(i => {
              const l = briefItemLine(i);
              return `<li><span class="attr">${escapeHtml(l.status)}</span> ${escapeHtml(l.text)}${l.details ? ` <span class="ids">[${escapeHtml(l.details)}]</span>` : ''}</li>`;
            })
            .join('')}</ul>`
    }`;
  return `${b.sections.map(section).join('')}${section(b.background)}<h3>Ограничения данных</h3><ul>${b.dataLimits.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
};

const HTML_STYLE = `
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111;background:#fff;margin:24px;line-height:1.45;font-size:14px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:22px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}h3{font-size:14px;margin:14px 0 6px}
.muted,.ids{color:#555;font-size:12px}.attr{font-weight:600;font-size:11px;text-transform:uppercase;color:#444}
ul.statements{padding-left:18px}ul.statements li{margin:0 0 8px}
blockquote{margin:4px 0 0;padding:4px 8px;border-left:3px solid #999;background:#f4f4f4;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;font-size:12px;table-layout:fixed}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
thead{display:table-header-group}tr{page-break-inside:avoid}
@media print{body{margin:12mm}h2{page-break-after:avoid}}
`;

export const snapshotToHtml = (meta: ISnapshotMeta, p: ISnapshotPayload): string => {
  const d = p.dossier;
  const companyLine = p.company
    ? `${escapeHtml(p.company.name)}${p.company.legalForm ? `, ${escapeHtml(p.company.legalForm)}` : ''}${p.company.identifiers.length ? ` — ${escapeHtml(p.company.identifiers.join(', '))}` : ' — реквизиты не установлены'}`
    : `юрлицо не установлено (со слов: «${escapeHtml(p.case.companyNameClaimed)}»)`;
  const sourcesRows = p.sources
    .map(s => {
      const href = safeHref(s.url);
      return `<tr><td>#${s.evidenceId}</td><td>#${s.assertionId}</td><td>${escapeHtml(s.stance)}</td><td>${escapeHtml(s.sourceTitle)}${href ? `<br><a href="${escapeHtml(href)}" rel="noreferrer noopener">${escapeHtml(href)}</a>` : ''}</td><td>ред. ${s.revisionNo} (#${s.revisionId}), [${s.spanStart}, ${s.spanEnd})</td><td>${escapeHtml(dateOnly(s.publishedAt))}</td><td>${s.quote === null ? `<span class="muted">${escapeHtml(s.withheldReason ?? 'цитата недоступна')}</span>` : `«${escapeHtml(s.quote)}»`}</td></tr>`;
    })
    .join('');
  const edgesRows = p.graph.edges
    .map(e => `<tr><td>${escapeHtml(EDGE[e.type] ?? e.type)}</td><td>${escapeHtml(e.from)} → ${escapeHtml(e.to)}</td><td>${escapeHtml(e.role ?? '')}</td><td>${escapeHtml([e.building, e.workPackage].filter(Boolean).join(', '))}</td><td>${escapeHtml(e.validFrom ? `${e.validFrom}${e.validTo ? ` — ${e.validTo}` : ''}` : '—')}</td><td>${escapeHtml(e.status)}</td><td>${e.assertionId ? `#${e.assertionId}` : escapeHtml(e.details.join('; '))}</td></tr>`)
    .join('');
  const nodes = new Map(p.graph.nodes.map(n => [n.key, n.label]));

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; base-uri 'none'">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(`Досье: ${p.case.title}`)}</title><style>${HTML_STYLE}</style></head>
<body>
<h1>${escapeHtml(p.case.title)}</h1>
<p class="muted">Снимок №${meta.id} обращения №${meta.caseId} · создан ${escapeHtml(p.generatedAt)} · знания на ${escapeHtml(p.knowledgeCutoff)} · ${escapeHtml(p.effective.note)} · версии: ${escapeHtml(`${p.versions.template}, ${p.versions.signalsRules}, ${p.versions.graph}`)}</p>
<p class="muted">Целостность: ${escapeHtml(meta.hashAlgorithm)} ${escapeHtml(meta.payloadHash)} — показывает, что содержание не менялось; не подпись и не подтверждение истинности.</p>
<h2>Кратко для переговоров</h2>
${htmlBrief(d.brief)}
<p class="muted">Ниже — приложения-основания: полное досье, связи, решения и источники. Печать — браузерная («Версия для печати»), не PDF-генератор.</p>
<h2>Компания и предмет обращения</h2>
<p>${companyLine}</p>
<p>Объект: ${p.project ? escapeHtml(`${p.project.name}${p.project.city ? `, ${p.project.city}` : ''}`) : escapeHtml(p.case.projectNameClaimed ?? 'не выбран')}${p.case.scopeBuilding ? `, ${escapeHtml(p.case.scopeBuilding)}` : ''} · дата обращения ${escapeHtml(p.case.requestDate)}</p>
${htmlStatements(d.subject, '')}
<h2>Существенные наблюдения</h2>
${htmlStatements(d.observations, 'Наблюдений нет.')}
<h2>Роль</h2>
${htmlStatements([...(d.role.claimed ? [d.role.claimed] : []), ...d.role.contradictions, ...d.role.established, ...d.role.otherBuildings, ...(d.role.context ?? [])], 'Роль не установлена.')}
<h2>Кто заказывает работы</h2>
${htmlStatements([...(d.chain.claimed ? [d.chain.claimed] : []), ...d.chain.documented, ...d.chain.subcontracts, ...d.chain.coParticipants, ...(d.chain.context ?? [])], 'Договоров не найдено.')}
<h2>Условия</h2>
${htmlStatements([...(d.terms.claimed ? [d.terms.claimed] : []), ...d.terms.fromSources], 'Условия в источниках не указаны.')}
<h2>События и контекст объекта</h2>
${htmlStatements([...d.projectContext.state, ...d.projectContext.events, ...d.companyEvents], 'Событий не найдено.')}
<h2>Что не установлено</h2>
${htmlStatements(d.uncertainties, 'Существенных пробелов не выявлено.')}
<h2>Вопросы контрагенту</h2>
${d.questions.length ? `<ol>${d.questions.map(q => `<li>${escapeHtml(q.text)}</li>`).join('')}</ol>` : '<p class="muted">Нет.</p>'}
<h2>Связи</h2>
${p.graph.edges.length ? `<table><thead><tr><th>Тип</th><th>Стороны</th><th>Роль</th><th>Корпус, работы</th><th>Период</th><th>Статус</th><th>Основание</th></tr></thead><tbody>${edgesRows}</tbody></table><p class="muted">Узлы: ${escapeHtml([...nodes.entries()].map(([k, v]) => `${k} — ${v}`).join('; '))}. ${escapeHtml(p.graph.notes.join(' '))}</p>` : '<p class="muted">Связей нет.</p>'}
<h2>Решения аналитика</h2>
${p.reviews.length ? `<ul>${p.reviews.map(r => `<li>утв. #${r.assertionId}: ${escapeHtml(r.decision)} (${escapeHtml(r.scope)}), ${escapeHtml(r.decidedAt)}${r.reason ? ` — ${escapeHtml(r.reason)}` : ''}</li>`).join('')}</ul>` : '<p class="muted">Решений не было.</p>'}
${p.openQueue.length ? `<p class="muted">Открытые вопросы проверки на момент снимка: ${p.openQueue.map(q => `${escapeHtml(q.kind)} #${q.assertionId}`).join(', ')}</p>` : ''}
<h2>Источники</h2>
${p.sources.length ? `<table><thead><tr><th>Док.</th><th>Утв.</th><th>Позиция</th><th>Источник</th><th>Редакция, span</th><th>Дата</th><th>Цитата</th></tr></thead><tbody>${sourcesRows}</tbody></table>` : '<p class="muted">Источников нет.</p>'}
<h2>Ограничения</h2>
<ul>${p.limitations.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
<p class="muted">${escapeHtml(d.disclaimer)}</p>
</body></html>
`;
};

// ---------------------------------------------------------------------------
// Markdown

/** Экранирование Markdown: служебные символы, угловые скобки (сырой HTML) и переводы строк внутри значения. */
export const escapeMarkdown = (value: unknown): string =>
  String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/([\\`*_{}[\]()#+\-.!|>~])/g, '\\$1')
    .replace(/</g, '&lt;');

const mdStatements = (items: IStatement[], empty: string): string =>
  items.length === 0
    ? `_${escapeMarkdown(empty)}_\n`
    : items
        .map(
          s =>
            `- **${escapeMarkdown(ATTRIBUTION[s.attribution] ?? s.attribution)}:** ${escapeMarkdown(s.text)}${s.assertionIds.length ? ` \\[утв. ${s.assertionIds.map(id => `\\#${id}`).join(', ')}\\]` : ''}\n${s.quotes
              .map(q => `  > «${escapeMarkdown(q.quote)}» — ${escapeMarkdown(q.sourceTitle)}, ${escapeMarkdown(dateOnly(q.publishedAt))}, док. \\#${q.evidenceId}\n`)
              .join('')}`,
        )
        .join('');

const mdBrief = (b: INegotiationBrief | undefined): string[] => {
  if (!b) return ['_Краткое досье в снимке отсутствует (снимок до dossier-template@3)._', ''];
  const section = (x: IBriefSection): string[] => [
    `### ${escapeMarkdown(x.title)}`,
    '',
    ...(x.items.length === 0
      ? [`_${escapeMarkdown(x.empty)}_`]
      : x.items.map(i => {
          const l = briefItemLine(i);
          return `- **${escapeMarkdown(l.status)}:** ${escapeMarkdown(l.text)}${l.details ? ` \[${escapeMarkdown(l.details)}\]` : ''}`;
        })),
    '',
  ];
  return [...b.sections.flatMap(section), ...section(b.background), '### Ограничения данных', '', ...b.dataLimits.map(l => `- ${escapeMarkdown(l)}`), ''];
};

export const snapshotToMarkdown = (meta: ISnapshotMeta, p: ISnapshotPayload): string => {
  const d = p.dossier;
  const lines: string[] = [];
  lines.push(`# ${escapeMarkdown(p.case.title)}`, '');
  lines.push(
    `Снимок №${meta.id} обращения №${meta.caseId}. Создан ${escapeMarkdown(p.generatedAt)}; знания на ${escapeMarkdown(p.knowledgeCutoff)}. ${escapeMarkdown(p.effective.note)}`,
    '',
    `Целостность: ${escapeMarkdown(meta.hashAlgorithm)} \`${meta.payloadHash}\` — не подпись и не подтверждение истинности.`,
    '',
  );
  lines.push('## Кратко для переговоров', '', ...mdBrief(d.brief));
  lines.push('_Ниже — приложения-основания: полное досье, связи, решения и источники._', '');
  lines.push('## Компания и предмет обращения', '');
  lines.push(
    p.company
      ? `${escapeMarkdown(p.company.name)}${p.company.legalForm ? `, ${escapeMarkdown(p.company.legalForm)}` : ''} — ${p.company.identifiers.length ? escapeMarkdown(p.company.identifiers.join(', ')) : 'реквизиты не установлены'}`
      : `Юрлицо не установлено (со слов: «${escapeMarkdown(p.case.companyNameClaimed)}»)`,
    '',
  );
  lines.push(mdStatements(d.subject, ''));
  lines.push('## Существенные наблюдения', '', mdStatements(d.observations, 'Наблюдений нет.'));
  lines.push('## Роль', '', mdStatements([...(d.role.claimed ? [d.role.claimed] : []), ...d.role.contradictions, ...d.role.established, ...d.role.otherBuildings, ...(d.role.context ?? [])], 'Роль не установлена.'));
  lines.push('## Кто заказывает работы', '', mdStatements([...(d.chain.claimed ? [d.chain.claimed] : []), ...d.chain.documented, ...d.chain.subcontracts, ...d.chain.coParticipants, ...(d.chain.context ?? [])], 'Договоров не найдено.'));
  lines.push('## Условия', '', mdStatements([...(d.terms.claimed ? [d.terms.claimed] : []), ...d.terms.fromSources], 'Условия в источниках не указаны.'));
  lines.push('## События и контекст объекта', '', mdStatements([...d.projectContext.state, ...d.projectContext.events, ...d.companyEvents], 'Событий не найдено.'));
  lines.push('## Что не установлено', '', mdStatements(d.uncertainties, 'Существенных пробелов не выявлено.'));
  lines.push('## Вопросы контрагенту', '', ...(d.questions.length ? d.questions.map((q, i) => `${i + 1}\\. ${escapeMarkdown(q.text)}`) : ['_Нет._']), '');
  lines.push('## Связи', '');
  if (p.graph.edges.length) {
    lines.push('| Тип | Стороны | Роль | Корпус, работы | Период | Статус | Основание |', '|---|---|---|---|---|---|---|');
    for (const e of p.graph.edges) {
      lines.push(
        `| ${escapeMarkdown(EDGE[e.type] ?? e.type)} | ${escapeMarkdown(`${e.from} → ${e.to}`)} | ${escapeMarkdown(e.role ?? '')} | ${escapeMarkdown([e.building, e.workPackage].filter(Boolean).join(', '))} | ${escapeMarkdown(e.validFrom ?? '—')} | ${escapeMarkdown(e.status)} | ${e.assertionId ? `\\#${e.assertionId}` : escapeMarkdown(e.details.join('; '))} |`,
      );
    }
    lines.push('', `Узлы: ${escapeMarkdown(p.graph.nodes.map(n => `${n.key} — ${n.label}`).join('; '))}`, '');
  } else {
    lines.push('_Связей нет._', '');
  }
  lines.push('## Решения аналитика', '', ...(p.reviews.length ? p.reviews.map(r => `- утв. \\#${r.assertionId}: ${escapeMarkdown(r.decision)} (${escapeMarkdown(r.scope)}), ${escapeMarkdown(r.decidedAt)}${r.reason ? ` — ${escapeMarkdown(r.reason)}` : ''}`) : ['_Решений не было._']), '');
  lines.push('## Источники', '');
  if (p.sources.length) {
    lines.push('| Док. | Утв. | Позиция | Источник | Редакция, span | Дата | Цитата |', '|---|---|---|---|---|---|---|');
    for (const s of p.sources) {
      const href = safeHref(s.url);
      lines.push(
        `| \\#${s.evidenceId} | \\#${s.assertionId} | ${escapeMarkdown(s.stance)} | ${escapeMarkdown(s.sourceTitle)}${href ? ` <${href.replace(/[<>\s]/g, '')}>` : ''} | ред. ${s.revisionNo}, \\[${s.spanStart}, ${s.spanEnd}) | ${escapeMarkdown(dateOnly(s.publishedAt))} | ${s.quote === null ? escapeMarkdown(s.withheldReason ?? 'цитата недоступна') : `«${escapeMarkdown(s.quote)}»`} |`,
      );
    }
    lines.push('');
  } else {
    lines.push('_Источников нет._', '');
  }
  lines.push('## Ограничения', '', ...p.limitations.map(l => `- ${escapeMarkdown(l)}`), '', `_${escapeMarkdown(d.disclaimer)}_`, '');
  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// JSON

export const SNAPSHOT_EXPORT_SCHEMA = 'dossier-snapshot-export@1';

export const snapshotToJson = (meta: ISnapshotMeta, p: ISnapshotPayload, availability: unknown): string =>
  `${JSON.stringify(
    {
      exportSchema: SNAPSHOT_EXPORT_SCHEMA,
      snapshot: { id: meta.id, caseId: meta.caseId, payloadHash: meta.payloadHash, hashAlgorithm: meta.hashAlgorithm, generatedAt: meta.generatedAt },
      availability,
      payload: p,
    },
    null,
    2,
  )}\n`;
