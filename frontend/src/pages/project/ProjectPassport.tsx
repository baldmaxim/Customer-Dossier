// Паспорт объекта — первым на странице объекта, если есть сведения ДОМ.РФ (02.10.2026): статус, сдача,
// ключи, квартиры, цена, распроданность крупно; застройщик и группа — ссылками на их карточки; ниже
// атрибуция и сведения домов.
//
// Объект — по домам (07.10.2026): у ЖК десятки домов реестра. Главные числа — свод по домам (сервер,
// registry/houses.ts; подписи — lib/registrySummary.ts, те же, что у карточки объекта во вкладке «Объекты»), а
// каждый дом — своими сведениями и своей историей изменений раскрытием. Раньше паспорт показывал страницу дома,
// изменившуюся последней, а «последнее изменение» сравнивало соседние дома.
//
// Это текст сайта на дату, а не проверенный факт: дата и атрибуция стоят всегда, слово «проверено»
// не используется (ADR-012).
//
// Сведений нет — `ProjectRegistryMissing`: словами, что сведений нет, и похожие объекты со сведениями
// («возможно, это тот же объект») — ссылкой, а не подстановкой чужих данных; оператору — привязка
// карточки ДОМ.РФ ссылкой (`ProjectDomRfLink`).

import { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { IProjectDossier, IProjectRegistry, IProjectRegistryHouse } from '../../api/types';
import { RegistryChanges, registryDateText } from '../../components/RegistryChanges';
import { RegistryPanel, registryRows } from '../../components/RegistryPanel';
import { Callout } from '../../components/ui/Callout';
import { DescriptionList, type IDescriptionItem } from '../../components/ui/DescriptionList';
import { Disclosure } from '../../components/ui/Disclosure';
import { Section } from '../../components/ui/Section';
import { LinkifiedText } from '../../components/LinkifiedText';
import { ObjectPhoto } from '../../components/company/ObjectPhoto';
import { useCan } from '../../hooks/useAuth';
import { formatCount, formatCountWord } from '../../lib/format';
import { formatDate, formatPercent } from '../../lib/labels';
import { completionText, priceRangeText, registryStatusText } from '../../lib/registrySummary';
import styles from '../ProjectPage.module.css';
import { ProjectDomRfLink } from './ProjectDomRfLink';

const HOUSES = ['дом', 'дома', 'домов'] as const;

/** Поле снимка дома по подписи: проектная декларация — ссылкой на сайт. */
const houseField = (house: IProjectRegistryHouse, label: string): string | null =>
  house.fields.find(f => f.label === label && f.value.trim() !== '')?.value ?? null;

const companyLink = (company: { id: number; name: string } | null | undefined, text: string): ReactNode =>
  company ? (
    <Link to={`/company/${company.id}`} viewTransition>
      {text}
    </Link>
  ) : (
    text
  );

/** «Корпус 2 · Строится · сдача IV кв. 2027» — строка раскрытия дома. */
const houseSummary = (house: IProjectRegistryHouse): string =>
  [house.name, house.status, house.completion ? `сдача ${house.completion}` : null].filter(Boolean).join(' · ');

export const ProjectPassport: FC<{ registry: IProjectRegistry; projectId: number; name: string }> = ({ registry, projectId, name }) => {
  const { summary, houses } = registry;
  const single = houses.length === 1 ? houses[0]! : null;
  const facts = [
    { title: 'Статус', value: registryStatusText(summary) },
    { title: houses.length > 1 ? 'Сдача домов' : 'Сдача дома', value: completionText(summary) },
    { title: 'Выдача ключей', value: summary.keys },
    { title: 'Квартир', value: summary.apartments !== null ? formatCount(summary.apartments) : null },
    { title: 'Цена за 1 м²', value: priceRangeText(summary.pricePerSqm) },
    { title: 'Продано', value: summary.soldShare !== null ? formatPercent(summary.soldShare) : null },
    { title: 'Класс', value: summary.propertyClass },
    { title: 'Этажей', value: summary.floors },
  ].filter((f): f is { title: string; value: string } => f.value !== null);
  const declaration = single ? houseField(single, 'Проектная декларация') : null;

  const lines: IDescriptionItem[] = [];
  if (summary.address) lines.push({ label: 'Адрес', value: summary.address });
  if (summary.developer) lines.push({ label: 'Застройщик', value: companyLink(registry.developerCompany, summary.developer) });
  if (summary.group) lines.push({ label: 'Группа компаний', value: companyLink(registry.groupCompany, summary.group) });
  if (summary.contractors.length > 0) {
    lines.push({ label: summary.contractors.length > 1 ? 'Генподрядчики' : 'Генподрядчик', value: summary.contractors.map(c => c.name).join(', ') });
  }
  if (declaration) lines.push({ label: 'Проектная декларация', value: <LinkifiedText text={declaration} /> });

  return (
    <Section
      title="Паспорт объекта"
      note={single ? `${summary.sourceTitle}, запись ${single.externalRef}` : `${summary.sourceTitle}, ${formatCountWord(houses.length, HOUSES)}`}
    >
      <div className={styles.passport}>
        {/* Фото и главные числа — рядом с 600px (в колонке справа с 1280px — снова друг под другом). */}
        <div className={summary.hasPhoto ? styles.passportTop : styles.passportTopSingle}>
          {summary.hasPhoto && (
            <figure className={styles.passportFigure}>
              <ObjectPhoto projectId={projectId} name={name} className={styles.passportPhoto} eager />
              <figcaption className={styles.passportCaption}>Фото: наш.дом.рф</figcaption>
            </figure>
          )}
          <div className={styles.passportSummary}>
            <p className={styles.passportDate}>
              {single ? registryDateText(single.asOf, single.fetchedAt) : `Сведения домов на ${formatDate(summary.asOf)} и раньше — дата у каждого дома`}
            </p>
            {facts.length > 0 && (
              <dl className={styles.passportFacts}>
                {facts.map(f => (
                  <div key={f.title} className={styles.passportFact}>
                    <dt>{f.title}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
        {lines.length > 0 && <DescriptionList items={lines} />}
        <Callout tone="neutral">{registry.attribution}</Callout>
        {single ? (
          <>
            <RegistryChanges changes={single.changes.slice(0, 1)} title="Последнее изменение на ДОМ.РФ" />
            <Disclosure summary="Все сведения ДОМ.РФ" meta={formatCountWord(registryRows(single).length, ['поле', 'поля', 'полей'])}>
              <div className={styles.passport}>
                <DescriptionList items={registryRows(single)} />
                <RegistryChanges changes={single.changes} />
              </div>
            </Disclosure>
          </>
        ) : (
          // Каждый дом — своими сведениями и своей историей: изменения сравниваются только внутри дома.
          <div className={styles.passport}>
            {houses.map(house => (
              <Disclosure key={`${house.source.key}:${house.externalRef}`} summary={houseSummary(house)}>
                <RegistryPanel registry={house} variant="full" attribution={false} bare />
              </Disclosure>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
};

export const ProjectRegistryMissing: FC<{ dossier: IProjectDossier }> = ({ dossier }) => {
  const canReview = useCan('admin.view');
  const lookalikes = dossier.registryLookalikes ?? [];
  return (
    <Callout tone="neutral" title="Сведений ДОМ.РФ по объекту нет">
      <p className={styles.calloutText}>
        Объект знаком порталу только по публикациям. Объекты застройщиков, подтверждённых в «Источники → наш.дом.рф», собираются
        с сайта сами и перечитываются раз в неделю.
      </p>
      {lookalikes.length > 0 && (
        <>
          <p className={styles.calloutText}>Возможно, это тот же объект — у него сведения ДОМ.РФ есть:</p>
          <ul className={styles.lookalikes}>
            {lookalikes.map(l => (
              <li key={l.projectId}>
                <Link to={`/projects/${l.projectId}`} viewTransition>
                  {l.name}
                </Link>
                {l.city ? `, ${l.city}` : ''}
                {l.reason === 'merge_queue' ? ' — пара ждёт решения в «Проверке»' : ''}
              </li>
            ))}
          </ul>
          {canReview && (
            <p className={styles.calloutText}>
              Если это один объект, объедините карточки: <Link to="/admin/review?tab=duplicates">«Проверка» → «Дубли»</Link>.
            </p>
          )}
        </>
      )}
      <ProjectDomRfLink projectId={dossier.project.id} />
    </Callout>
  );
};
