import { FC, useState } from 'react';

import type { IBriefItem, IBriefSection, INegotiationBrief } from '../api/types';
import styles from '../pages/Dossier.module.css';
import { AssertionDetail } from './AssertionDetail';

interface IBriefProps {
  brief: INegotiationBrief;
  /** Снимок: утверждения не подгружаются из текущей базы — основания в разделе «Источники» снимка. */
  frozen?: boolean;
}

const Item: FC<{ item: IBriefItem; frozen: boolean }> = ({ item, frozen }) => {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <li className={styles.statement}>
      <span className={styles.attribution}>{item.statusLabel}</span>
      <span className={styles.statementText}>{item.text}</span>
      <span className={styles.quoteMeta}>
        {[
          item.scope ? `область: ${item.scope}` : null,
          item.asOf ? `свежесть: ${item.asOf}` : null,
          item.sources.publications > 0 ? `источники: ${item.sources.label}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {item.pendingRevision && <span className={styles.warn}>Есть более новая редакция публикации — вывод по прежнему тексту, нужен пересмотр.</span>}
      {item.assertionIds.length > 0 &&
        (frozen ? (
          <span className={styles.quoteMeta}>
            основания: утв. {item.assertionIds.map(id => `#${id}`).join(', ')}; док. {item.evidenceIds.map(id => `#${id}`).join(', ')} — в разделе «Источники»
          </span>
        ) : (
          <span className={styles.row}>
            {item.assertionIds.map(id => (
              <button key={id} type="button" className={styles.linkButton} aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
                {open === id ? 'скрыть' : 'открыть'} основание #{id}
              </button>
            ))}
          </span>
        ))}
      {open !== null && !frozen && <AssertionDetail assertionId={open} />}
    </li>
  );
};

const Section: FC<{ section: IBriefSection; frozen: boolean }> = ({ section, frozen }) => (
  <div>
    <h3 className={styles.statusLine}>{section.title}</h3>
    {section.items.length === 0 ? (
      <p className={styles.meta}>{section.empty}</p>
    ) : (
      <ul className={styles.statements}>
        {section.items.map((i, n) => (
          <Item key={`${i.code}-${n}`} item={i} frozen={frozen} />
        ))}
      </ul>
    )}
  </div>
);

/**
 * Кратко для переговоров (этап 17): вокруг вопроса обращения, статус каждого пункта словами, область, свежесть,
 * происхождение публикаций и основания. Общий фон — отдельно. Итоговой оценки и рекомендаций нет.
 */
export const NegotiationBrief: FC<IBriefProps> = ({ brief, frozen = false }) => (
  <section className={styles.section} aria-labelledby="brief">
    <h2 id="brief" className={styles.sectionTitle}>
      Кратко для переговоров
    </h2>
    {brief.sections.map(s => (
      <Section key={s.key} section={s} frozen={frozen} />
    ))}
    {brief.questions.length > 0 && (
      <div>
        <h3 className={styles.statusLine}>Что запросить у контрагента (рабочий список, не обвинения)</h3>
        <ol className={styles.questions}>
          {brief.questions.map(q => (
            <li key={q.code}>{q.text}</li>
          ))}
        </ol>
      </div>
    )}
    <details>
      <summary>{brief.background.title}: {brief.background.items.length}</summary>
      <Section section={brief.background} frozen={frozen} />
    </details>
    <div>
      <h3 className={styles.statusLine}>Ограничения данных</h3>
      <ul className={styles.list}>
        {brief.dataLimits.map(l => (
          <li key={l} className={styles.meta}>
            {l}
          </li>
        ))}
      </ul>
    </div>
  </section>
);
