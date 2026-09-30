// Связи: один центр обхода и схема вокруг него.
//
// Всё состояние — в адресе: центр (?company=N или ?project=N), вид (view), типы связей и прочие
// фильтры. На схему можно сослаться, «Назад» возвращает прежний центр. Двух центров одновременно
// не бывает: два узла-основы в одном обходе склеивают несвязанные подграфы и читаются как
// «эти компании связаны». Схема — первой на экране: фильтры, кроме типов связей, свёрнуты.

import { FC, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import type { IGraphNode } from '../api/types';
import { EntityPicker } from '../components/EntityPickers';
import type { IEntityRef } from '../components/entitySearch';
import { GraphBody } from '../components/graph/GraphBody';
import { GraphFilters } from '../components/graph/GraphFilters';
import { centerKey, linksHref, nodeCardHref, type IGraphCenter, type NodeTarget } from '../components/graph/graphModel';
import { useGraphQuery } from '../components/graph/useGraphQuery';
import { useUrlGraphState } from '../components/graph/useGraphState';
import { ButtonLink } from '../components/ui/ButtonLink';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { shortenLegalForm } from '../lib/legalForm';
import { MQ } from '../lib/media';
import styles from './LinksPage.module.css';

/** Имя нового центра приходит вместе с переходом: заголовок не ждёт, пока построится схема. */
interface ILinksLocationState {
  centerLabel?: string;
}

const parseId = (raw: string | null): number | null => {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const centerFrom = (params: URLSearchParams): IGraphCenter | null => {
  const company = parseId(params.get('company'));
  if (company) return { kind: 'company', id: company };
  const project = parseId(params.get('project'));
  return project ? { kind: 'project', id: project } : null;
};

export const LinksPage: FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const center = centerFrom(params);
  const wide = useMediaQuery(MQ.sm);
  // На телефоне по умолчанию таблица: схема шире экрана, списком связи читаются лучше.
  const state = useUrlGraphState(wide ? 'schema' : 'table');
  const query = useGraphQuery(center, state.filters);
  const [picked, setPicked] = useState<IEntityRef | null>(null);
  const key = centerKey(center);
  const firstCenter = useRef(true);

  // Новый центр — как новая страница: адрес меняется только в query, и оболочка фокус не двигает,
  // а нажатый узел исчезает вместе со старой схемой. Фокус — на заголовок «Связи: …».
  useEffect(() => {
    if (firstCenter.current) {
      firstCenter.current = false;
      return;
    }
    document.querySelector<HTMLElement>('main h1, h1')?.focus({ preventScroll: true });
  }, [key]);

  const seed = query.data && !query.isPlaceholderData ? query.data.nodes.find(n => n.seed) : undefined;
  const fromState = (location.state as ILinksLocationState | null)?.centerLabel;
  const pickedName = picked && center && picked.kind === center.kind && picked.id === center.id ? picked.name : undefined;
  const fullName = center ? (seed?.label ?? pickedName ?? fromState ?? null) : null;
  // «ООО» вместо «Общество с ограниченной ответственностью»: заголовок в две строки, а не в четыре.
  const centerName = fullName ? shortenLegalForm(fullName) : null;

  const open = (entity: IGraphCenter, name: string): void => {
    navigate(linksHref(entity, params), { state: { centerLabel: name } satisfies ILinksLocationState });
  };

  // Узел на схеме и имя в таблице — ссылка на те же «Связи» с новым центром и теми же фильтрами.
  const target: NodeTarget = {
    kind: 'link',
    to: (node: IGraphNode) => linksHref(node, params),
    state: (node: IGraphNode) => ({ centerLabel: node.label }) satisfies ILinksLocationState,
    viewTransition: false,
    actionText: 'показать связи',
  };

  const title = center ? (centerName ? `Связи: ${centerName}` : 'Связи') : 'Связи компаний';

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={center ? (center.kind === 'company' ? 'Компания' : 'Объект') : undefined}
        title={title}
        lead={center ? undefined : 'Кто с кем связан по сообщениям источников: участие в объектах, договоры, корпоративные связи.'}
        actions={
          center && (
            <ButtonLink to={nodeCardHref(center)} iconEnd="forward">
              {center.kind === 'company' ? 'Карточка компании' : 'Карточка объекта'}
            </ButtonLink>
          )
        }
      />
      <div className={styles.picker}>
        <EntityPicker
          label="Чьи связи показать"
          hint="Компания или объект: название, ИНН или ОГРН"
          value={center && centerName ? { ...center, name: centerName } : null}
          onSelect={entity => {
            setPicked(entity);
            open(entity, entity.name);
          }}
        />
      </div>
      {center ? (
        <div className={styles.graph}>
          <GraphFilters state={state} />
          <GraphBody
            // Выбранная линия прежнего центра к новому не относится.
            key={key}
            query={query}
            state={state}
            target={target}
            centerName={centerName}
            size="lg"
            hint="Нажмите на компанию или объект — схема перестроится вокруг него, а «Назад» вернёт прежнюю. Нажмите на линию — увидите цитаты."
          />
        </div>
      ) : (
        <EmptyState
          title="Выберите центр схемы"
          action={
            <ButtonLink to="/" variant="secondary">
              К поиску компаний
            </ButtonLink>
          }
        >
          Схема строится вокруг одной компании или одного объекта — найдите его в поле выше или откройте из карточки.
        </EmptyState>
      )}
    </div>
  );
};
