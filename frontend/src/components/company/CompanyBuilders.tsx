// «Кто строит для компании» (этап 24D): генподрядчики и подрядчики на объектах, где компания — заказчик,
// застройщик или инвестор (сама или через СЗ своей группы).
//
// Два источника, и у каждой строки подписано, откуда она: ДОМ.РФ (строка «Генподрядчики» карточки объекта на
// дату снимка) и публикации (роль из разобранных текстов). Генподрядчик из ДОМ.РФ ведёт на карточку портала,
// только если та нашлась по ИНН или однозначно по названию; иначе — «Найти по ИНН» (поиск предложит завести
// юрлицо). «Своя группа» — генподрядчик входит в группу заказчика: строит своими силами.
// Компании, которая нигде не заказчик и не застройщик, блок не показывается: строить для неё некому.

import { CSSProperties, FC, useState } from 'react';
import { Link } from 'react-router-dom';

import type { IBuilderObject, ICompanyBuilder } from '../../api/types';
import { formatCount } from '../../lib/format';
import { ASSERTION_ROLE_LABELS, BUILDER_MATCH_LABELS, BUILDER_SOURCE_LABELS, formatDate } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Section } from '../ui/Section';
import { useCompanyBuilders } from './useCompanyQueries';
import styles from './CompanyBuilders.module.css';

export const BUILDERS_SECTION_ID = 'company-builders';

/** Строителей видно до «Показать ещё». */
const SHOWN = 6;
/** Объектов одного строителя в строке; остальные — числом. */
const OBJECTS_SHOWN = 3;

/** «ДОМ.РФ на 30.09.2026 · публикации: 3, последняя 01.10.2026». */
const objectSource = (o: IBuilderObject): string =>
  o.sources
    .map(source => {
      const label = BUILDER_SOURCE_LABELS[source] ?? source;
      if (source === 'registry') return o.registryAsOf ? `${label} на ${formatDate(o.registryAsOf)}` : label;
      const parts = [o.mentions !== null ? `${label}: ${formatCount(o.mentions)}` : label];
      if (o.lastPublication) parts.push(`последняя ${formatDate(o.lastPublication)}`);
      return parts.join(', ');
    })
    .join(' · ');

const BuilderRow: FC<{ builder: ICompanyBuilder; index: number }> = ({ builder: b, index }) => {
  const added = index >= SHOWN;
  const objects = b.objects.slice(0, OBJECTS_SHOWN);
  const matchNote = b.match ? BUILDER_MATCH_LABELS[b.match] : undefined;
  return (
    <li className={added ? `${styles.item} appear` : styles.item} style={added ? ({ '--i': index - SHOWN } as CSSProperties) : undefined}>
      <div className={styles.head}>
        {b.company ? (
          <Link className={styles.name} to={`/company/${b.company.id}`} viewTransition>
            {b.company.name}
          </Link>
        ) : (
          <span className={styles.nameText}>{b.name}</span>
        )}
        {b.roles.map(role => (
          <Badge key={role} tone="accent">
            {ASSERTION_ROLE_LABELS[role] ?? role}
          </Badge>
        ))}
        {b.inGroup && <Badge>своя группа</Badge>}
      </div>
      <p className={styles.meta}>
        {b.inn && <span>ИНН {b.inn}</span>}
        {matchNote && <span>{matchNote}</span>}
        {b.company && b.registryNames.length > 0 && b.registryNames[0] !== b.company.name && (
          <span>в ДОМ.РФ: {b.registryNames.join(', ')}</span>
        )}
        {!b.company && b.inn && (
          <ButtonLink to={`/?q=${b.inn}`} variant="link" size="sm" iconEnd="forward">
            Найти по ИНН
          </ButtonLink>
        )}
      </p>
      <ul className={styles.objects}>
        {objects.map(o => (
          <li key={`${o.projectId}-${o.role}`} className={styles.object}>
            <Link className={styles.objectLink} to={`/projects/${o.projectId}`} viewTransition>
              «{o.name}»
            </Link>
            {!o.isCurrent && <span className={styles.past}> (в прошлом)</span>}
            <span className={styles.source}> — {objectSource(o)}</span>
          </li>
        ))}
        {b.objects.length > OBJECTS_SHOWN && (
          <li className={styles.more}>и ещё объектов: {formatCount(b.objects.length - OBJECTS_SHOWN)}</li>
        )}
      </ul>
    </li>
  );
};

export const CompanyBuilders: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useCompanyBuilders(companyId);
  const [expanded, setExpanded] = useState(false);
  const data = query.data;
  const counts = data?.objects;
  // Компания нигде не заказчик и не застройщик — «кто строит для неё» не вопрос. Ответ без objects
  // (старый сервер) — тоже не показываем: судить не по чему. Пока ответа нет, блока тоже нет: иначе у
  // подрядчика он мелькал бы скелетом и исчезал, сдвигая «Сведения».
  if (query.isLoading || (query.isSuccess && (counts?.customerSide ?? 0) === 0)) return null;

  const items = data?.items ?? [];
  const visible = expanded ? items : items.slice(0, SHOWN);
  const hidden = items.length - visible.length;

  return (
    <Section
      id={BUILDERS_SECTION_ID}
      title="Кто строит для компании"
      note={counts ? `объектов заказчика: ${formatCount(counts.customerSide)}${counts.truncated ? ' (из первых в списке)' : ''}` : undefined}
      footer={
        hidden > 0 && (
          <Button variant="link" iconEnd="chevron" aria-expanded={false} onClick={() => setExpanded(true)}>
            Показать ещё {formatCount(hidden)}
          </Button>
        )
      }
    >
      {query.isError && (
        <Callout
          tone="danger"
          title="Генподрядчики не загрузились"
          action={
            <Button size="sm" onClick={() => void query.refetch()}>
              Повторить
            </Button>
          }
        >
          {describeLoadError(query.error)}
        </Callout>
      )}
      {query.isSuccess && counts && items.length === 0 && (
        <EmptyState size="sm">
          Генподрядчик не назван: в ДОМ.РФ — сведения есть у {formatCount(counts.withRegistry)} из{' '}
          {formatCount(counts.customerSide)} объектов, генподрядчика в них нет; в публикациях — не найден.
        </EmptyState>
      )}
      {items.length > 0 && (
        <ul className={styles.list}>
          {visible.map((builder, i) => (
            <BuilderRow key={builder.key} builder={builder} index={i} />
          ))}
        </ul>
      )}
      {items.length > 0 && counts && (
        <p className={styles.note}>
          ДОМ.РФ называет генподрядчика у {formatCount(counts.withRegistryContractor)} из {formatCount(counts.customerSide)}{' '}
          объектов — это сведения сайта на дату, не проверенный договор. Роль из публикаций — так написано в тексте.
        </p>
      )}
    </Section>
  );
};
