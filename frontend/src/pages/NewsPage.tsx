// «Новое» (этап 24F): что портал узнал за окно дней — новые объекты с названным заказчиком (к нему генподрядчик может
// выйти первым), смена сроков сдачи домов ДОМ.РФ, новые дела картотеки и производства ФССП у проверенных компаний.
//
// Охват, окно и вид — в адресе (useUrlState). «Новое» помечено относительно отметки «просмотрено до» в браузере
// (newsSeen.ts); «Отметить всё просмотренным» сдвигает её на самую свежую новость. Слова — фактами, без оценок
// (ADR-009). Общей ленты публикаций здесь нет (ADR-016): новость ведёт к объекту, компании и основанию.

import { FC, Fragment } from 'react';
import { Link } from 'react-router-dom';

import type { INewsItem, NewsKind, NewsScope } from '../api/types';
import { isUnseen, markNewsSeen, useNewsSeen } from '../components/news/newsSeen';
import { useNews } from '../components/news/useNews';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Cluster } from '../components/ui/Cluster';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { Section } from '../components/ui/Section';
import { Segmented } from '../components/ui/Segmented';
import { Stack } from '../components/ui/Stack';
import { enumParam, useUrlState } from '../hooks/useUrlState';
import { formatCount } from '../lib/format';
import { NEWS_KIND_LABELS, NEWS_SOURCE_LABELS, formatDate, formatMoney, formatTime, roleLabel } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import styles from './NewsPage.module.css';

const SCOPES = ['all', 'watched'] as const;

/** «№ 1-ИП — 1,2 млн ₽; № 2-ИП; и другие»: суммы по строкам — тем же formatMoney, что карточка; не складываются. */
const detailText = (item: INewsItem): string =>
  [...(item.amounts ?? []).map(a => (a.rub !== null ? `${a.label} — ${formatMoney(a.rub)}` : a.label)), ...(item.detail ? [item.detail] : [])].join('; ');
const KINDS = ['any', 'new_project', 'deadline_shift', 'court_case', 'fssp', 'bankruptcy'] as const;
/** Окна ленты — те же, что принимает сервер (NEWS_DAYS), строками для адреса. */
const DAYS = ['7', '14', '30'] as const;

const SourceLink: FC<{ item: INewsItem }> = ({ item }) => {
  const { source } = item;
  const label = NEWS_SOURCE_LABELS[source.kind];
  if (source.kind === 'publication' && source.documentId !== null) {
    return (
      <Link to={`/documents/${source.documentId}`} viewTransition>
        {label}
      </Link>
    );
  }
  if (source.href?.startsWith('/')) return <Link to={source.href}>{label}</Link>;
  if (source.href) {
    return (
      <a href={source.href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  }
  return <>{label}</>;
};

const NewsRow: FC<{ item: INewsItem; fresh: boolean }> = ({ item, fresh }) => (
  <li className={styles.item}>
    <div className={styles.head}>
      <Badge>{NEWS_KIND_LABELS[item.kind]}</Badge>
      {fresh && <Badge tone="accent">новое</Badge>}
      {item.watched && <Badge>на контроле</Badge>}
      <span className={styles.time}>{formatTime(item.at)}</span>
    </div>
    <p className={styles.title}>
      {item.project ? (
        <Link to={`/projects/${item.project.id}`} viewTransition>
          {item.title}
        </Link>
      ) : (
        item.title
      )}
    </p>
    {(item.amounts?.length || item.detail) && <p className={styles.detail}>{detailText(item)}</p>}
    {item.companies.length > 0 && (
      <p className={styles.companies}>
        {item.companies.slice(0, 4).map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 && ', '}
            <Link to={`/company/${c.id}`} viewTransition>
              {c.name}
            </Link>
            {c.role ? ` — ${roleLabel(c.role)}` : ''}
          </Fragment>
        ))}
        {item.companies.length > 4 ? ` и ещё ${formatCount(item.companies.length - 4)}` : ''}
      </p>
    )}
    <p className={styles.source}>
      основание: <SourceLink item={item} />
    </p>
  </li>
);

/** Новости по дням: заголовок дня — дата, внутри новые сверху. */
const byDay = (items: readonly INewsItem[]): Array<{ day: string; items: INewsItem[] }> => {
  const out: Array<{ day: string; items: INewsItem[] }> = [];
  for (const item of items) {
    const day = formatDate(item.at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
};

export const NewsPage: FC = () => {
  const [scope, setScope] = useUrlState('scope', enumParam<NewsScope>(SCOPES, 'all'));
  const [days, setDays] = useUrlState('days', enumParam(DAYS, '14'));
  const [kind, setKind] = useUrlState('kind', enumParam(KINDS, 'any'));
  const query = useNews({ days: Number(days), scope, kind: kind === 'any' ? null : (kind as NewsKind) });
  const seenUpTo = useNewsSeen();

  const items = query.data?.items ?? [];
  const counts = query.data?.counts;
  const unseen = items.filter(i => isUnseen(i.at, seenUpTo)).length;
  const kindItems = KINDS.map(k => ({
    value: k,
    label: k === 'any' ? 'Всё' : `${NEWS_KIND_LABELS[k]}${counts ? ` · ${formatCount(counts[k])}` : ''}`,
  }));

  return (
    <Stack gap={4}>
      <PageHeader
        title="Новое"
        lead="Что портал узнал за последние дни: новые объекты с названным заказчиком, смена сроков сдачи домов ДОМ.РФ, новые арбитражные дела, исполнительные производства и сообщения ЕФРСБ о судебных актах у проверенных компаний."
      />
      <Cluster gap={3} align="center">
        <Segmented
          label="Чьё"
          value={scope}
          onChange={setScope}
          items={[
            { value: 'all', label: 'Все' },
            { value: 'watched', label: 'На контроле' },
          ]}
        />
        <Segmented label="Период" value={days} onChange={setDays} items={DAYS.map(d => ({ value: d, label: `${d} дней` }))} />
      </Cluster>
      <Segmented label="Вид" value={kind} onChange={setKind} items={kindItems} />

      {query.isLoading && <LoadingSkeleton label="Загружаю новое…" lines={5} height="64px" />}
      {query.isError && (
        <Callout tone="danger" title="Лента не загрузилась" action={<Button onClick={() => void query.refetch()}>Повторить</Button>}>
          {describeLoadError(query.error)}
        </Callout>
      )}
      {query.isSuccess && items.length === 0 && (
        <EmptyState>
          {scope === 'watched'
            ? 'У компаний «на контроле» за это время нового нет. Поставить компанию на контроль — кнопкой в её карточке.'
            : 'За это время нового нет.'}
        </EmptyState>
      )}
      {items.length > 0 && (
        <Section
          title={`Новостей: ${formatCount(items.length)}`}
          note={unseen > 0 ? `непросмотренных — ${formatCount(unseen)}` : 'всё просмотрено'}
          actions={
            unseen > 0 ? (
              <Button size="sm" icon="check" onClick={() => markNewsSeen(items.reduce((max, i) => (i.at > max ? i.at : max), items[0]!.at))}>
                Отметить всё просмотренным
              </Button>
            ) : undefined
          }
        >
          {byDay(items).map(group => (
            <div key={group.day} className={styles.day}>
              <h2 className={styles.dayTitle}>{group.day}</h2>
              <ul className={styles.list}>
                {group.items.map(item => (
                  <NewsRow key={item.key} item={item} fresh={isUnseen(item.at, seenUpTo)} />
                ))}
              </ul>
            </div>
          ))}
        </Section>
      )}
    </Stack>
  );
};
