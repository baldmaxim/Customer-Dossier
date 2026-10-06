// Паспорт объекта — первым на странице объекта, если есть снимок ДОМ.РФ (02.10.2026): статус, сдача,
// ключи, квартиры, цена, распроданность крупно; застройщик и группа — ссылками на их карточки; ниже
// атрибуция, последнее изменение и «Все сведения ДОМ.РФ» раскрытием.
//
// Это текст сайта на дату, а не проверенный факт: дата и атрибуция стоят всегда, слово «проверено»
// не используется (ADR-012). Значения — как на сайте, без пересчёта.
//
// Снимка нет — `ProjectRegistryMissing`: словами, что сведений нет, и похожие объекты со сведениями
// («возможно, это тот же объект») — ссылкой, а не подстановкой чужих данных; оператору — привязка
// карточки ДОМ.РФ ссылкой (`ProjectDomRfLink`).

import { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { IProjectDossier, IRegistryView } from '../../api/types';
import { RegistryChanges, registryDateText } from '../../components/RegistryChanges';
import { registryRows } from '../../components/RegistryPanel';
import { Callout } from '../../components/ui/Callout';
import { DescriptionList, type IDescriptionItem } from '../../components/ui/DescriptionList';
import { Disclosure } from '../../components/ui/Disclosure';
import { Section } from '../../components/ui/Section';
import { LinkifiedText } from '../../components/LinkifiedText';
import { ObjectPhoto } from '../../components/company/ObjectPhoto';
import { useCan } from '../../hooks/useAuth';
import { formatCountWord } from '../../lib/format';
import { withLegalForm } from '../../lib/legalForm';
import styles from '../ProjectPage.module.css';
import { ProjectDomRfLink } from './ProjectDomRfLink';

/** Поле снимка по одной из подписей: у страницы сайта и у API подписи разные. */
const field = (registry: IRegistryView, ...labels: string[]): string | null => {
  for (const label of labels) {
    const found = registry.fields.find(f => f.label === label && f.value.trim() !== '');
    if (found) return found.value;
  }
  return null;
};

/** Главные числа паспорта — в этом порядке, только сообщённые сайтом. */
const KEY_FACTS: ReadonlyArray<{ title: string; labels: string[] }> = [
  { title: 'Статус', labels: ['Статус строительства'] },
  { title: 'Сдача дома', labels: ['Сдача дома', 'Срок сдачи'] },
  { title: 'Выдача ключей', labels: ['Выдача ключей'] },
  { title: 'Квартир', labels: ['Количество квартир'] },
  { title: 'Цена за 1 м²', labels: ['Средняя цена за 1 м²', 'Средняя цена за м2'] },
  { title: 'Распроданность', labels: ['Распроданность квартир', 'Продано квартир'] },
  { title: 'Класс', labels: ['Класс недвижимости'] },
  { title: 'Этажей', labels: ['Количество этажей'] },
];

const companyLink = (company: { id: number; name: string } | null | undefined, text: string): ReactNode =>
  company ? (
    <Link to={`/company/${company.id}`} viewTransition>
      {text}
    </Link>
  ) : (
    text
  );

export const ProjectPassport: FC<{ registry: IRegistryView; projectId: number; name: string }> = ({ registry, projectId, name }) => {
  const facts = KEY_FACTS.map(f => ({ title: f.title, value: field(registry, ...f.labels) })).filter(
    (f): f is { title: string; value: string } => f.value !== null,
  );
  const developerName = registry.developer ? withLegalForm(registry.developer.name, registry.developer.legalForm) : field(registry, 'Застройщик');
  const groupName = registry.groupName ?? field(registry, 'Группа компаний');
  const contractor = field(registry, 'Генподрядчики', 'Генподрядчик');
  const declaration = field(registry, 'Проектная декларация');

  const lines: IDescriptionItem[] = [];
  if (registry.address) lines.push({ label: 'Адрес', value: registry.address });
  if (developerName) lines.push({ label: 'Застройщик', value: companyLink(registry.developerCompany, developerName) });
  if (groupName) lines.push({ label: 'Группа компаний', value: companyLink(registry.groupCompany, groupName) });
  if (contractor) lines.push({ label: 'Генподрядчик', value: contractor });
  if (declaration) lines.push({ label: 'Проектная декларация', value: <LinkifiedText text={declaration} /> });
  const all = registryRows(registry);

  return (
    <Section title="Паспорт объекта" note={`${registry.source.title}, запись ${registry.externalRef}`}>
      <div className={styles.passport}>
        {/* Фото и главные числа — рядом с 600px (в колонке справа с 1280px — снова друг под другом). */}
        <div className={registry.hasPhoto ? styles.passportTop : styles.passportTopSingle}>
          {registry.hasPhoto && (
            <figure className={styles.passportFigure}>
              <ObjectPhoto projectId={projectId} name={name} className={styles.passportPhoto} eager />
              <figcaption className={styles.passportCaption}>Фото: наш.дом.рф</figcaption>
            </figure>
          )}
          <div className={styles.passportSummary}>
            <p className={styles.passportDate}>{registryDateText(registry.asOf, registry.fetchedAt)}</p>
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
        <RegistryChanges changes={registry.changes.slice(0, 1)} title="Последнее изменение на ДОМ.РФ" />
        <Disclosure summary="Все сведения ДОМ.РФ" meta={formatCountWord(all.length, ['поле', 'поля', 'полей'])}>
          <div className={styles.passport}>
            <DescriptionList items={all} />
            <RegistryChanges changes={registry.changes} />
          </div>
        </Disclosure>
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
