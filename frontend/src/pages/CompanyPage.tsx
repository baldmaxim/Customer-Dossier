// Карточка компании: шапка (наименование по ЕГРЮЛ, реквизиты сеткой, «На контроле», «Схема связей») и
// вкладки в порядке сути портала (ADR-016) — «Сведения · Объекты · Публикации · Подробно»: сначала
// юрлицо, потом его объекты, потом публикации. Вкладка, открытый пост и фильтры объектов — в адресе
// (?tab=, ?post=, ?orole=, ?osrc=): «Назад» возвращает прежнюю вкладку, ссылкой можно поделиться.
// Содержимое вкладок — в components/company/*, здесь только сборка и состояния загрузки.
//
// Шапка одна во всех состояниях и стоит на том же месте дерева: заголовок страницы (h1)
// остаётся тем же элементом, пока данные грузятся, — фокус после перехода не теряется,
// когда вместо «Компания» появляется имя.

import { FC, ReactNode, useId } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { CompanyDetails } from '../components/company/CompanyDetails';
import { CompanyObjects } from '../components/company/CompanyObjects';
import { CompanySiteProjects } from '../components/company/CompanySiteProjects';
import { CompanyInfo, hasLegalIdentifier } from '../components/company/CompanyInfo';
import { CompanyPublications } from '../components/company/CompanyPublications';
import { CompanyRequisites, objectRoleCounts } from '../components/company/CompanyRequisites';
import { CompanyUnidentified } from '../components/company/CompanyUnidentified';
import { CompanySimilar } from '../components/company/CompanySimilar';
import { useCompany, useCompanyFocus, useCompanyObjects } from '../components/company/useCompanyQueries';
import { WatchToggle } from '../components/company/WatchToggle';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Button } from '../components/ui/Button';
import { ButtonLink } from '../components/ui/ButtonLink';
import { Callout } from '../components/ui/Callout';
import { Disclosure } from '../components/ui/Disclosure';
import { EmptyState } from '../components/ui/EmptyState';
import { Hint } from '../components/ui/Hint';
import { PageHeader, type IPageHeaderProps } from '../components/ui/PageHeader';
import { Stack } from '../components/ui/Stack';
import { TabPanel } from '../components/ui/TabPanel';
import { Tabs } from '../components/ui/Tabs';
import { enumParam, useUrlPatch, useUrlState } from '../hooks/useUrlState';
import { describeLoadError } from '../lib/loadError';
import styles from './CompanyPage.module.css';

const TAB_VALUES = ['info', 'objects', 'publications', 'details'] as const;
type Tab = (typeof TAB_VALUES)[number];

const TAB_LABELS: Record<Tab, string> = {
  info: 'Сведения',
  objects: 'Объекты',
  publications: 'Публикации',
  details: 'Подробно',
};

const notFound = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

const GROUP_HINT =
  'У группы нет своего ИНН: сведения ЕГРЮЛ — у её юрлиц. Юрлица группы — в «С кем связана» и на вкладке «Объекты».';
const UNIDENTIFIED_HINT =
  'Имя из публикаций без ИНН: какое это юрлицо, портал не знает, поэтому сведений ЕГРЮЛ нет. Назначьте имя компании — кандидаты под ярлыком «Назначить компании».';

export const CompanyPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const companyId = Number(id);
  const valid = Number.isInteger(companyId) && companyId > 0;
  const query = useCompany(companyId, valid);
  // Число объектов — у вкладки: запрос общий с «Обзором» и вкладкой, второго нет.
  const objects = useCompanyObjects(companyId, valid && query.isSuccess);
  // Сведения ЕГРЮЛ для шапки — после карточки; не загрузились — шапка без них, ошибку покажет раздел «Подробно».
  const focus = useCompanyFocus(companyId, valid && Boolean(query.data?.company));
  const [tab] = useUrlState('tab', enumParam(TAB_VALUES, 'info'));
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
            К компаниям
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
      patch({ tab: next === 'info' ? null : next, post: null, orole: null, osrc: null }, { history: 'push' });
    const objectsTotal = objects.data?.coverage.total;
    const tabs = TAB_VALUES.map(value => ({
      value,
      label: TAB_LABELS[value],
      count: value === 'objects' && objectsTotal !== undefined && objectsTotal > 0 ? objectsTotal : undefined,
    }));
    header = {
      // Наименование по ЕГРЮЛ, если Фокус его прислал; имя из публикаций — строкой реквизитов. Роли — по своим
      // объектам из того же запроса, что и число у вкладки; на читалке шапка — без длинных строк.
      title: data.egrul?.name ?? company.name,
      meta: (
        <CompanyRequisites
          data={data}
          focus={focus.data?.fields ? focus.data : null}
          roles={objectRoleCounts(objects.data?.items ?? [])}
          compact={reader}
        />
      ),
      actions: (
        <>
          <WatchToggle companyId={company.id} watch={data.watch ?? null} />
          <ButtonLink to={`/links?company=${company.id}`} icon="links">
            Схема связей
          </ButtonLink>
        </>
      ),
      children: (
        <>
          {/* Имя без ИНН: кандидаты и решения — свёрнуты под ярлыком в шапке, на любой вкладке. */}
          {company.entityType !== 'group' && !hasLegalIdentifier(data) && (
            <Disclosure variant="card" summary="Назначить компании" className={styles.assign}>
              <CompanyUnidentified companyId={company.id} data={data} />
            </Disclosure>
          )}
          {/* Похожие — только на «Сведениях»: в «Подробно» они в «Опознании», а на читалке каждая
              строка высоты отнята у поста. */}
          {tab === 'info' && <CompanySimilar companyId={company.id} />}
          {/* Вкладки — записи истории: стрелки только ведут фокус, выбор — Enter или пробел. */}
          <Tabs label="Разделы компании" idBase={idBase} items={tabs} value={tab} onChange={selectTab} activation="manual" />
        </>
      ),
    };
    body = (
      <TabPanel idBase={idBase} value={tab} focusable={tab === 'info'} className={reader ? styles.readerPanel : styles.panel}>
        {tab === 'info' && <CompanyInfo companyId={company.id} data={data} />}
        {tab === 'objects' && (
          <Stack gap={4}>
            <CompanyObjects companyId={company.id} />
            <CompanySiteProjects companyId={company.id} />
          </Stack>
        )}
        {tab === 'publications' && <CompanyPublications companyId={company.id} />}
        {tab === 'details' && <CompanyDetails companyId={company.id} data={data} />}
      </TabPanel>
    );
  }

  // У группы своего ИНН нет, у имени без ИНН юрлицо не установлено — это сказано подсказкой у надписи над
  // названием, а не блоком на «Сведениях» (05.10.2026, просьба владельца).
  let eyebrow: ReactNode = 'Компания';
  if (data?.company?.entityType === 'group') {
    eyebrow = (
      <>
        Группа компаний <Hint label="группа компаний" text={GROUP_HINT} />
      </>
    );
  } else if (data?.company && !hasLegalIdentifier(data)) {
    eyebrow = (
      <>
        Юрлицо не установлено <Hint label="юрлицо не установлено" text={UNIDENTIFIED_HINT} />
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow={eyebrow} className={`${styles.header} ${reader ? styles.readerHeader : ''}`} {...header} />
      {body}
    </>
  );
};
