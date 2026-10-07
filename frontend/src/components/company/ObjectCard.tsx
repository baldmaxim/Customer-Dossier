// Карточка объекта на вкладке «Объекты» и в превью «Обзора»: статус и срок сдачи сверху, название
// крупно, адрес, генподрядчик по ДОМ.РФ (24D), три главных числа ДОМ.РФ, роль компании, «через СЗ …» для объектов группы и
// источник сведений внизу. Вся карточка — ссылка на страницу объекта (row-link); ссылка на СЗ
// поднята над ней (row-link-above) и остаётся отдельной целью.
//
// Сведения ДОМ.РФ — текст сайта на дату, а не проверенный факт: внизу всегда «ДОМ.РФ · на дату». Фото —
// сверху полосой 2:1 во всю ширину карточки; пока его нет — заглушка того же размера (подпись «фото и
// сведения» — внизу). Статус и срок сдачи — ярлыками поверх полосы (05.10.2026: отдельной строкой они
// удлиняли каждую карточку, а заглушка стояла пустой). Адрес — одной строкой с полным текстом в подсказке.
// Без сведений ДОМ.РФ — состояние по событиям из публикаций, если оно есть, и «только из публикаций».

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { ICompanyObject } from '../../api/types';
import { contractorNames } from '../../lib/contractors';
import { ASSERTION_ROLE_LABELS, CONTEXT_STATE_LABELS, PROJECT_LEVEL_LABELS, formatDate } from '../../lib/labels';
import { Badge } from '../ui/Badge';
import { Heading } from '../ui/Heading';
import { Icon } from '../ui/Icon';
import { ObjectPhoto } from './ObjectPhoto';
import styles from './ObjectCard.module.css';

/** Три числа карточки — по порядку важности, только те, что реестр сообщил. */
const factsOf = (o: ICompanyObject): Array<{ label: string; value: string }> => {
  const r = o.registry;
  if (!r) return [];
  return [
    { label: 'Квартир', value: r.apartments },
    { label: 'Цена м²', value: r.pricePerSqm },
    { label: 'Продано', value: r.sold },
    { label: 'Класс', value: r.propertyClass },
    { label: 'Этажей', value: r.floors },
  ]
    .filter((f): f is { label: string; value: string } => Boolean(f.value))
    .slice(0, 3);
};

/** С заглавной, как статус на сайте ДОМ.РФ: «Строится» рядом со «строится» читалось как два разных. */
const capitalized = (text: string): string => text.charAt(0).toLocaleUpperCase('ru') + text.slice(1);

/** Статус словами: с сайта ДОМ.РФ как есть, иначе состояние по событиям публикаций. */
const statusOf = (o: ICompanyObject): string | null => {
  if (o.registry?.status) return o.registry.status;
  const label = o.state ? CONTEXT_STATE_LABELS[o.state.state] : undefined;
  return label ? capitalized(label) : null;
};

export const ObjectCard: FC<{ object: ICompanyObject }> = ({ object: o }) => {
  const status = statusOf(o);
  const completion = o.registry?.completion ?? null;
  const facts = factsOf(o);
  const place = o.registry?.address ?? o.city;
  const level = o.level && o.level !== 'complex' ? PROJECT_LEVEL_LABELS[o.level] : null;
  const placeText = `${level ? `${level} · ` : ''}${place ?? 'адрес не указан'}`;
  const contractor = contractorNames(o.registry?.contractor);
  // Фото ещё нет (сбор ДОМ.РФ до объекта не дошёл, галереи нет) — заглушка того же размера: ряды ровные.
  const placeholder = (
    <div className={`${styles.photo} ${styles.placeholder}`} aria-hidden="true">
      <Icon name="building" size="lg" />
    </div>
  );

  return (
    <article className={`${styles.card} row-link`}>
      <div className={styles.media}>
        {o.registry?.hasPhoto ? (
          <ObjectPhoto projectId={o.projectId} name={o.name} className={styles.photo} thumb fallback={placeholder} />
        ) : (
          placeholder
        )}
        {(status || completion) && (
          <p className={styles.top}>
            {status && <span className={styles.status}>{status /* raw-ok: подпись сайта ДОМ.РФ */}</span>}
            {completion && <span className={styles.completion}>сдача: {completion}</span>}
          </p>
        )}
      </div>
      <Heading className={styles.title}>
        <Link className="row-link-target" to={`/projects/${o.projectId}`} viewTransition>
          {o.name}
        </Link>
      </Heading>
      <p className={styles.place} title={placeText}>
        {placeText}
      </p>
      {contractor && (
        <p className={styles.contractor} title={contractor}>
          генподрядчик: {contractor}
        </p>
      )}
      {facts.length > 0 && (
        <dl className={styles.facts}>
          {facts.map(f => (
            <div key={f.label} className={styles.fact}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className={styles.roles}>
        {o.roles.length === 0 && <Badge>{o.basis === 'event' ? 'упомянут в событиях, роль не названа' : 'роль не названа'}</Badge>}
        {o.roles.map(r => (
          <Badge key={r.role} tone="accent">
            {ASSERTION_ROLE_LABELS[r.role] ?? r.role}
            {r.isCurrent ? '' : ' (в прошлом)'}
          </Badge>
        ))}
        {o.via && (
          <span className={styles.via}>
            через{' '}
            <Link className={`row-link-above ${styles.viaLink}`} to={`/company/${o.via.companyId}`} viewTransition>
              {o.via.name}
            </Link>
          </span>
        )}
      </div>
      <p className={styles.source}>
        <Icon name={o.registry ? 'building' : 'document'} size="sm" />
        {o.registry
          ? `ДОМ.РФ${o.registry.hasPhoto ? ' · фото и сведения' : ''} · на ${formatDate(o.registry.asOf ?? o.registry.fetchedAt)}`
          : 'только из публикаций'}
      </p>
    </article>
  );
};
