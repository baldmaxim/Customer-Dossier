// «Роли, события и тексты» на вкладке «Сведения»: разбивки уже посчитанных показателей полосами
// (05.10.2026, просьба владельца о графиках). Ни одного нового числа — те же byRole, eventsByType,
// courtRoles, полнота и происхождение текстов, что в «Подробно → Показатели» с правилом и id; здесь
// только форма. У каждой разбивки — знаменатель словами, нулевой — блок не рисуется, а его название
// попадает в строку «Нет данных: …». Итоговой оценки и сортировки «по риску» нет (ADR-009): роли и
// виды — по числу, суды и тексты — в постоянном порядке.
//
// Номинальные категории (роли, виды событий, суды) — BarList одним цветом; порядковые (полнота,
// происхождение) — StackedBar ступенями. Показатели не посчитаны — блока нет: это говорит сводка и
// «Источники и даты».

import { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { ICompanySignals } from '../../api/types';
import { formatCountWord } from '../../lib/format';
import { ASSERTION_ROLE_LABELS, COMPLETENESS_LABELS, COURT_ROLE_GROUP_LABELS, EVENT_LABELS, FAMILY_ORIGIN_LABELS } from '../../lib/labels';
import { BarList, type IBarListItem } from '../charts/BarList';
import { StackedBar, type IStackSegment } from '../charts/StackedBar';
import { Heading } from '../ui/Heading';
import { Icon } from '../ui/Icon';
import { Section } from '../ui/Section';
import { useCompanySignals } from './useCompanyQueries';
import styles from './Company.module.css';

const EVENTS = ['событие', 'события', 'событий'] as const;
/** После «из» — родительный падеж: «из 1 объекта», «из 3 объектов». */
const OF_OBJECTS = ['объекта', 'объектов', 'объектов'] as const;
const OF_CASES = ['дела', 'дел', 'дел'] as const;
const PUBLICATIONS = ['публикация', 'публикации', 'публикаций'] as const;
const TEXTS = ['текст', 'текста', 'текстов'] as const;
const KINDS = ['вид', 'вида', 'видов'] as const;

interface IBlock {
  key: string;
  title: string;
  caption: string;
  chart: ReactNode;
}

const okValue = (agg: { value: number | null; status: string } | undefined): number | null =>
  agg && agg.status === 'ok' && agg.value !== null ? agg.value : null;

const byCount = (items: IBarListItem[]): IBarListItem[] => [...items].sort((a, b) => b.value - a.value);

/** Роли на объектах: знаменатель — разные объекты с учтённым участием (одна компания бывает в двух ролях). */
const rolesBlock = (s: ICompanySignals): IBlock | null => {
  const projects = okValue(s.experience?.projects);
  const items = byCount(
    Object.entries(s.experience?.byRole ?? {})
      .map(([role, agg]) => ({ key: role, label: ASSERTION_ROLE_LABELS[role] ?? 'роль не названа', value: okValue(agg) ?? 0 }))
      .filter(i => i.value > 0),
  );
  if (items.length === 0) return null;
  return {
    key: 'roles',
    title: 'Роли на объектах',
    caption: projects !== null ? `из ${formatCountWord(projects, OF_OBJECTS)} с участием` : 'по объектам с участием',
    chart: <BarList label="Роли на объектах" items={items} total={projects} />,
  };
};

/** События по видам: знаменатель — сумма видов (у события один вид). */
const eventTypesBlock = (s: ICompanySignals): IBlock | null => {
  const items = byCount(
    Object.entries(s.media?.eventsByType ?? {})
      .map(([type, agg]) => ({ key: type, label: EVENT_LABELS[type] ?? 'прочие', value: okValue(agg) ?? 0 }))
      .filter(i => i.value > 0),
  );
  if (items.length === 0) return null;
  const sum = items.reduce((t, i) => t + i.value, 0);
  return {
    key: 'events',
    title: 'События по видам',
    caption: `всего ${formatCountWord(sum, EVENTS)}`,
    chart: <BarList label="События по видам" items={items} restText={(n, m) => `ещё ${formatCountWord(n, KINDS)} — ${formatCountWord(m, EVENTS)}`} />,
  };
};

/** Суды: роль компании в деле, знаменатель — число дел. */
const courtsBlock = (s: ICompanySignals): IBlock | null => {
  const cases = okValue(s.media?.legalCasesCount);
  const roles = s.media?.courtRoles;
  if (!roles || !cases) return null;
  const items = (['plaintiff', 'defendant', 'other', 'unknown'] as const)
    .map(k => ({ key: k, label: COURT_ROLE_GROUP_LABELS[k], value: roles[k] }))
    .filter(i => i.value > 0);
  if (items.length === 0) return null;
  return {
    key: 'courts',
    title: 'Роль в судебных делах',
    caption: `из ${formatCountWord(cases, OF_CASES)}`,
    chart: <BarList label="Роль в судебных делах" items={items} total={cases} />,
  };
};

/** Полнота текстов публикаций: от полного текста к неполученному; failed и unknown — одной ступенью. */
const completenessBlock = (s: ICompanySignals): IBlock | null => {
  const counts = s.identity?.coverage?.completeness;
  if (!counts) return null;
  const segments: IStackSegment[] = [
    { key: 'full', label: COMPLETENESS_LABELS.full, value: counts.full ?? 0 },
    { key: 'excerpt', label: COMPLETENESS_LABELS.excerpt, value: counts.excerpt ?? 0 },
    { key: 'caption_only', label: COMPLETENESS_LABELS.caption_only, value: counts.caption_only ?? 0 },
    { key: 'other', label: 'текст не получен или полнота неизвестна', value: (counts.failed ?? 0) + (counts.unknown ?? 0) },
  ];
  const sum = segments.reduce((t, x) => t + x.value, 0);
  if (sum === 0) return null;
  return {
    key: 'completeness',
    title: 'Полнота текстов',
    caption: formatCountWord(sum, PUBLICATIONS),
    chart: <StackedBar label="Полнота текстов" segments={segments} />,
  };
};

/** Происхождение: разные тексты (перепечатки — как один) по тому, известен ли первоисточник. */
const originBlock = (s: ICompanySignals): IBlock | null => {
  const origin = s.media?.familiesByOrigin;
  const families = okValue(s.media?.families);
  if (!origin || !families) return null;
  const segments: IStackSegment[] = (['established', 'named', 'unknown'] as const).map(k => ({
    key: k,
    label: FAMILY_ORIGIN_LABELS[k],
    value: okValue(origin[k]) ?? 0,
  }));
  return {
    key: 'origin',
    title: 'Откуда тексты',
    caption: `${formatCountWord(families, TEXTS)}, перепечатки — как один`,
    chart: <StackedBar label="Откуда тексты" segments={segments} total={families} />,
  };
};

const BLOCKS: Array<{ title: string; build: (s: ICompanySignals) => IBlock | null }> = [
  { title: 'роли', build: rolesBlock },
  { title: 'события по видам', build: eventTypesBlock },
  { title: 'суды', build: courtsBlock },
  { title: 'полнота текстов', build: completenessBlock },
  { title: 'происхождение текстов', build: originBlock },
];

export const CompanyStructure: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useCompanySignals(companyId);
  const signals = query.data?.signals;
  if (!signals) return null;

  const built = BLOCKS.map(b => ({ title: b.title, block: b.build(signals) }));
  const blocks = built.flatMap(b => (b.block ? [b.block] : []));
  const missing = built.filter(b => !b.block).map(b => b.title);
  if (blocks.length === 0) return null;

  return (
    <Section
      title="Роли, события и тексты"
      note={query.data?.refresh.active ? 'по расчёту показателей' : undefined}
      footer={
        <Link className={styles.structureMore} to={{ search: '?tab=details&dtab=numbers' }}>
          Как посчитано <Icon name="forward" size="sm" />
        </Link>
      }
    >
      <div className={styles.structure}>
        {blocks.map(b => (
          <div key={b.key} className={styles.structureBlock}>
            <Heading className={styles.structureTitle}>
              {b.title} <span className={styles.structureCaption}>{b.caption}</span>
            </Heading>
            {b.chart}
          </div>
        ))}
      </div>
      {missing.length > 0 && <p className={styles.structureMissing}>Нет данных: {missing.join(', ')}.</p>}
    </Section>
  );
};
