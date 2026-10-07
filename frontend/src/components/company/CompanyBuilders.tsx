// «Кто строит для компании» (этап 24D): генподрядчики и подрядчики на объектах, где компания — заказчик,
// застройщик или инвестор (сама или через СЗ своей группы).
//
// Два источника: ДОМ.РФ (строка «Генподрядчики» карточки объекта на дату снимка) и публикации (роль из
// разобранных текстов). Генподрядчик из ДОМ.РФ ведёт на карточку портала, только если та нашлась по ИНН или
// однозначно по названию. «Своя группа» — генподрядчик входит в группу заказчика: строит своими силами.
// Строка — имя, роль и число объектов (07.10.2026, просьба владельца: на телефоне подробности занимали экран);
// ИНН, как найдена карточка и каждый объект с источниками и датами — окном «Подробнее» (BuilderDetailsDialog).
// Компании, которая нигде не заказчик и не застройщик, блок не показывается: строить для неё некому.

import { CSSProperties, FC, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import type { ICompanyBuilder } from '../../api/types';
import { formatCount, pluralize } from '../../lib/format';
import { roleLabel } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Section } from '../ui/Section';
import { BuilderDetailsDialog, builderObjectCount } from './BuilderDetailsDialog';
import { useCompanyBuilders } from './useCompanyQueries';
import styles from './CompanyBuilders.module.css';

export const BUILDERS_SECTION_ID = 'company-builders';

/** Строителей видно до «Показать ещё». */
const SHOWN = 6;

/** «на 1 объекте», «на 37 объектах». */
const onObjects = (n: number): string => `на ${formatCount(n)} ${pluralize(n, ['объекте', 'объектах', 'объектах'])}`;

interface IBuilderRowProps {
  builder: ICompanyBuilder;
  index: number;
  onDetails: (builder: ICompanyBuilder) => void;
}

const BuilderRow: FC<IBuilderRowProps> = ({ builder: b, index, onDetails }) => {
  const added = index >= SHOWN;
  const name = b.company?.name ?? b.name;
  return (
    <li className={added ? `${styles.item} appear` : styles.item} style={added ? ({ '--i': index - SHOWN } as CSSProperties) : undefined}>
      <div className={styles.main}>
        <div className={styles.head}>
          {b.company ? (
            <Link className={styles.name} to={`/company/${b.company.id}`} viewTransition>
              {name}
            </Link>
          ) : (
            <span className={styles.nameText}>{name}</span>
          )}
          {b.roles.map(role => (
            <Badge key={role} tone="accent">
              {roleLabel(role)}
            </Badge>
          ))}
          {b.inGroup && <Badge>своя группа</Badge>}
        </div>
        <p className={styles.meta}>
          {onObjects(builderObjectCount(b))}
          {!b.company && ' · карточки в портале нет'}
        </p>
      </div>
      <Button
        variant="ghost"
        iconOnly
        icon="more"
        aria-label={`Подробнее: ${name}`}
        aria-haspopup="dialog"
        hint="Подробнее: объекты, источники, даты"
        onClick={() => onDetails(b)}
      />
    </li>
  );
};

export const CompanyBuilders: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useCompanyBuilders(companyId);
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<ICompanyBuilder | null>(null);
  // Окно привязано к записи истории: переход по ссылке из него (объект, карточка строителя, новая компания)
  // закрывает его. Строитель остаётся выбранным после закрытия — окно доигрывает выход с содержимым.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
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
            <BuilderRow
              key={builder.key}
              builder={builder}
              index={i}
              onDetails={b => {
                setSelected(b);
                setOpenedAt(location.key);
              }}
            />
          ))}
        </ul>
      )}
      {items.length > 0 && counts && (
        <p className={styles.note}>
          ДОМ.РФ называет генподрядчика у {formatCount(counts.withRegistryContractor)} из {formatCount(counts.customerSide)}{' '}
          объектов.
        </p>
      )}
      <BuilderDetailsDialog builder={selected} open={openedAt !== null && openedAt === location.key} onClose={() => setOpenedAt(null)} />
    </Section>
  );
};
