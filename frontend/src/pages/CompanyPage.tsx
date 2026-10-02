// Карточка компании: шапка (имя, реквизиты сеткой, «Схема связей») и три вкладки — «Обзор ·
// Публикации · Подробно». Вкладка и открытый пост — в адресе (?tab=, ?post=): «Назад»
// возвращает прежнюю вкладку, ссылкой можно поделиться. Содержимое вкладок — в
// components/company/*, здесь только сборка и состояния загрузки.
//
// Шапка одна во всех состояниях и стоит на том же месте дерева: заголовок страницы (h1)
// остаётся тем же элементом, пока данные грузятся, — фокус после перехода не теряется,
// когда вместо «Компания» появляется имя.

import { FC, ReactNode, useId } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { CompanyDetails } from '../components/company/CompanyDetails';
import { CompanyOverview } from '../components/company/CompanyOverview';
import { CompanyPublications } from '../components/company/CompanyPublications';
import { CompanyRequisites } from '../components/company/CompanyRequisites';
import { CompanySimilar } from '../components/company/CompanySimilar';
import { useCompany } from '../components/company/useCompanyQueries';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Button } from '../components/ui/Button';
import { ButtonLink } from '../components/ui/ButtonLink';
import { Callout } from '../components/ui/Callout';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader, type IPageHeaderProps } from '../components/ui/PageHeader';
import { TabPanel } from '../components/ui/TabPanel';
import { Tabs } from '../components/ui/Tabs';
import { enumParam, useUrlPatch, useUrlState } from '../hooks/useUrlState';
import { describeLoadError } from '../lib/loadError';
import styles from './CompanyPage.module.css';

const TAB_VALUES = ['overview', 'publications', 'details'] as const;
type Tab = (typeof TAB_VALUES)[number];

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'overview', label: 'Обзор' },
  { value: 'publications', label: 'Публикации' },
  { value: 'details', label: 'Подробно' },
];

const notFound = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

export const CompanyPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const companyId = Number(id);
  const valid = Number.isInteger(companyId) && companyId > 0;
  const query = useCompany(companyId, valid);
  const [tab] = useUrlState('tab', enumParam(TAB_VALUES, 'overview'));
  const patch = useUrlPatch();
  const idBase = useId();

  const data = query.data;
  if (data?.mergedInto) return <Navigate to={`/company/${data.mergedInto}`} replace />;

  let header: Pick<IPageHeaderProps, 'title' | 'meta' | 'actions' | 'children'>;
  let body: ReactNode;
  const reader = tab === 'publications';

  if (valid && query.isLoading) {
    header = { title: 'Компания' };
    body = <LoadingSkeleton label="Загружаю карточку компании…" lines={5} height="72px" radius="md" />;
  } else if (valid && query.isError && !notFound(query.error)) {
    header = { title: 'Не удалось загрузить компанию' };
    body = (
      <Callout tone="danger" title="Карточка не загрузилась" action={<Button onClick={() => void query.refetch()}>Повторить</Button>}>
        {describeLoadError(query.error)}
      </Callout>
    );
  } else if (!valid || !data?.company) {
    header = { title: 'Компания не найдена' };
    body = (
      <EmptyState
        action={
          <ButtonLink to="/" icon="search">
            К поиску
          </ButtonLink>
        }
      >
        {valid
          ? 'Такой карточки нет: возможно, адрес набран с ошибкой или карточку убрали.'
          : 'В адресе нет номера карточки компании.'}
      </EmptyState>
    );
  } else {
    const { company } = data;
    const selectTab = (next: Tab): void =>
      patch({ tab: next === 'overview' ? null : next, post: null }, { history: 'push' });
    header = {
      title: company.name,
      meta: <CompanyRequisites data={data} />,
      actions: (
        <ButtonLink to={`/links?company=${company.id}`} icon="links">
          Схема связей
        </ButtonLink>
      ),
      children: (
        <>
          {/* Похожие — только на «Обзоре»: в «Подробно» они в «Опознании», а на читалке каждая
              строка высоты отнята у поста. */}
          {tab === 'overview' && <CompanySimilar companyId={company.id} />}
          {/* Вкладки — записи истории: стрелки только ведут фокус, выбор — Enter или пробел. */}
          <Tabs label="Разделы компании" idBase={idBase} items={TABS} value={tab} onChange={selectTab} activation="manual" />
        </>
      ),
    };
    body = (
      <TabPanel idBase={idBase} value={tab} focusable={tab === 'overview'} className={reader ? styles.readerPanel : styles.panel}>
        {tab === 'overview' && <CompanyOverview companyId={company.id} />}
        {tab === 'publications' && <CompanyPublications companyId={company.id} />}
        {tab === 'details' && <CompanyDetails companyId={company.id} data={data} />}
      </TabPanel>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Компания" className={`${styles.header} ${reader ? styles.readerHeader : ''}`} {...header} />
      {body}
    </>
  );
};
