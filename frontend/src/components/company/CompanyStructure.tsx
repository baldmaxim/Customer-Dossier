// «Роли, события и тексты» на вкладке «Сведения»: разбивки полосами (05.10.2026, просьба владельца о графиках). С
// 07.10.2026 — из тех же наборов, что списки карточки: роли — вкладка «Объекты» (roles в её ответе), виды событий —
// список «Подробно → События» (stats в его ответе), полнота и происхождение текстов — лента публикаций
// (publication-stats). Снимок показателей больше не читается; судебных разбивок по публикациям нет — суды показывает
// «Суды, ФССП и банкротство» (КАД). У каждой разбивки — знаменатель словами, нулевой — блок не рисуется, а его название
// попадает в строку «Нет данных: …». Итоговой оценки и сортировки «по риску» нет (ADR-009).
//
// Номинальные категории (роли, виды событий) — BarList одним цветом; порядковые (полнота, происхождение) — StackedBar
// ступенями.

import { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { ICompanyObjectsResponse, IEventStats, IPublicationStats } from '../../api/types';
import { formatCountWord } from '../../lib/format';
import { COMPLETENESS_LABELS, EVENT_LABELS, FAMILY_ORIGIN_LABELS, roleLabel } from '../../lib/labels';
import { BarList, type IBarListItem } from '../charts/BarList';
import { StackedBar, type IStackSegment } from '../charts/StackedBar';
import { Heading } from '../ui/Heading';
import { Icon } from '../ui/Icon';
import { Section } from '../ui/Section';
import { useCompanyEvents, useCompanyObjects, useCompanyPublicationStats } from './useCompanyQueries';
import styles from './Company.module.css';

const EVENTS = ['событие', 'события', 'событий'] as const;
/** После «из» — родительный падеж: «из 1 объекта», «из 3 объектов». */
const OF_OBJECTS = ['объекта', 'объектов', 'объектов'] as const;
const PUBLICATIONS = ['публикация', 'публикации', 'публикаций'] as const;
const TEXTS = ['текст', 'текста', 'текстов'] as const;
const KINDS = ['вид', 'вида', 'видов'] as const;

interface IBlock {
  key: string;
  title: string;
  caption: string;
  chart: ReactNode;
}

interface IInputs {
  objects?: ICompanyObjectsResponse;
  events?: IEventStats;
  publications?: IPublicationStats;
}

const byCount = (items: IBarListItem[]): IBarListItem[] => [...items].sort((a, b) => b.value - a.value);

/** Роли на своих объектах: знаменатель — свои объекты (одна компания бывает в двух ролях); объекты СЗ группы — их роли. */
const rolesBlock = ({ objects }: IInputs): IBlock | null => {
  const items = byCount((objects?.roles ?? []).map(r => ({ key: r.role, label: roleLabel(r.role), value: r.count })));
  if (!objects || items.length === 0) return null;
  const own = objects.coverage.truncated ? null : objects.items.filter(o => !o.via).length;
  return {
    key: 'roles',
    title: 'Роли на объектах',
    caption: own !== null ? `из ${formatCountWord(own, OF_OBJECTS)} компании` : 'на своих объектах',
    chart: <BarList label="Роли на объектах" items={items} total={own} />,
  };
};

/** События по видам: знаменатель — все события списка (у события один вид). */
const eventTypesBlock = ({ events }: IInputs): IBlock | null => {
  const items = byCount((events?.byType ?? []).map(t => ({ key: t.type, label: EVENT_LABELS[t.type] ?? 'прочие', value: t.count })));
  if (!events || items.length === 0) return null;
  return {
    key: 'events',
    title: 'События по видам',
    caption: `всего ${formatCountWord(events.total, EVENTS)}`,
    chart: <BarList label="События по видам" items={items} restText={(n, m) => `ещё ${formatCountWord(n, KINDS)} — ${formatCountWord(m, EVENTS)}`} />,
  };
};

/** Полнота текстов публикаций: от полного текста к неполученному; failed и unknown — одной ступенью. */
const completenessBlock = ({ publications }: IInputs): IBlock | null => {
  const counts = publications?.completeness;
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
const originBlock = ({ publications }: IInputs): IBlock | null => {
  const families = publications?.families;
  if (!families || families.total === 0) return null;
  const segments: IStackSegment[] = (['established', 'named', 'unknown'] as const).map(k => ({ key: k, label: FAMILY_ORIGIN_LABELS[k], value: families[k] }));
  return {
    key: 'origin',
    title: 'Откуда тексты',
    caption: `${formatCountWord(families.total, TEXTS)}, перепечатки — как один`,
    chart: <StackedBar label="Откуда тексты" segments={segments} total={families.total} />,
  };
};

const BLOCKS: Array<{ title: string; build: (inputs: IInputs) => IBlock | null }> = [
  { title: 'роли', build: rolesBlock },
  { title: 'события по видам', build: eventTypesBlock },
  { title: 'полнота текстов', build: completenessBlock },
  { title: 'происхождение текстов', build: originBlock },
];

export const CompanyStructure: FC<{ companyId: number }> = ({ companyId }) => {
  const objects = useCompanyObjects(companyId).data;
  const events = useCompanyEvents(companyId).data?.stats;
  // Старый сервер маршрута итогов не знает (ответ без total) — разбивок текстов нет.
  const stats = useCompanyPublicationStats(companyId).data;
  const publications = typeof stats?.total === 'number' ? stats : undefined;
  if (!objects && !events && !publications) return null;

  const built = BLOCKS.map(b => ({ title: b.title, block: b.build({ objects, events, publications }) }));
  const blocks = built.flatMap(b => (b.block ? [b.block] : []));
  const missing = built.filter(b => !b.block).map(b => b.title);
  if (blocks.length === 0) return null;

  return (
    <Section
      title="Роли, события и тексты"
      footer={
        <Link className={styles.structureMore} to={{ search: '?tab=details' }}>
          Все события <Icon name="forward" size="sm" />
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
