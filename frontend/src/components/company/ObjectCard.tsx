// Карточка объекта на вкладке «Объекты» и в превью «Обзора»: статус и срок сдачи сверху, название
// крупно, адрес, генподрядчик по ДОМ.РФ (24D), три главных числа ДОМ.РФ, роль компании, «через СЗ …» для объектов группы и
// источник сведений внизу. Вся карточка — ссылка на страницу объекта (row-link); ссылка на СЗ
// поднята над ней (row-link-above) и остаётся отдельной целью.
//
// Сведения ДОМ.РФ — свод по домам объекта (сервер, registry/houses.ts; подписи — lib/registrySummary.ts, те же, что у
// паспорта): текст сайта на дату, а не проверенный факт, внизу всегда «ДОМ.РФ · на дату». Фото —
// сверху полосой 2:1 во всю ширину карточки; пока его нет — заглушка того же размера (подпись «фото и
// сведения» — внизу). Статус и срок сдачи — ярлыками поверх полосы (05.10.2026: отдельной строкой они
// удлиняли каждую карточку, а заглушка стояла пустой). Адрес — одной строкой с полным текстом в подсказке.
// Без сведений ДОМ.РФ — состояние по событиям из публикаций, если оно есть, и «только из публикаций».

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { ICompanyObject } from '../../api/types';
import { formatCountWord } from '../../lib/format';
import { ASSERTION_ROLE_LABELS, PROJECT_LEVEL_LABELS, formatDate } from '../../lib/labels';
import { completionText, objectStatusText, registryFacts } from '../../lib/registrySummary';
import { Badge } from '../ui/Badge';
import { Heading } from '../ui/Heading';
import { Icon } from '../ui/Icon';
import { ObjectPhoto } from './ObjectPhoto';
import styles from './ObjectCard.module.css';

const HOUSES = ['дом', 'дома', 'домов'] as const;

export const ObjectCard: FC<{ object: ICompanyObject }> = ({ object: o }) => {
  const status = objectStatusText(o);
  const completion = o.registry ? completionText(o.registry) : null;
  const facts = o.registry ? registryFacts(o.registry).slice(0, 3) : [];
  const place = o.registry?.address ?? o.city;
  const level = o.level && o.level !== 'complex' ? PROJECT_LEVEL_LABELS[o.level] : null;
  const placeText = `${level ? `${level} · ` : ''}${place ?? 'адрес не указан'}`;
  const contractor = o.registry && o.registry.contractors.length > 0 ? o.registry.contractors.map(c => c.name).join(', ') : null;
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
          ? `ДОМ.РФ${o.registry.houses > 1 ? ` · ${formatCountWord(o.registry.houses, HOUSES)}` : ''}${o.registry.hasPhoto ? ' · фото и сведения' : ''} · на ${formatDate(o.registry.asOf)}`
          : 'только из публикаций'}
      </p>
    </article>
  );
};
