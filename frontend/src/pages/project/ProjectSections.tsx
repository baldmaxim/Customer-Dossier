// Второстепенное об объекте — разделами: публикации об объекте (общей ленты нет, ADR-016), «Не учтено
// как участие», договоры, события и история состояния. Раздел, где есть что показать (до OPEN_UP_TO строк), раскрыт сразу:
// закрытые пустые и непустые выглядели одинаково, и страница казалась пустой. Схема связей — окном
// по кнопке в шапке, отдельного раздела нет (06.10.2026).

import { FC } from 'react';

import type { IProjectDossier } from '../../api/types';
import { StatementList } from '../../components/StatementList';
import { formatCount } from '../../lib/format';
import { ProjectPublications } from './ProjectPublications';
import { ProjectStateHistory } from './ProjectStateHistory';
import { SectionDisclosure } from './SectionDisclosure';
import styles from '../ProjectPage.module.css';

const countText = (n: number): string => (n > 0 ? formatCount(n) : 'нет');

/** Длиннее — раздел остаётся свёрнутым: длинный список не должен отодвигать остальное. */
const OPEN_UP_TO = 10;
const openIf = (n: number): boolean => n > 0 && n <= OPEN_UP_TO;

export const ProjectSections: FC<{ dossier: IProjectDossier }> = ({ dossier: d }) => (
  <div className={styles.sections}>
    <SectionDisclosure summary="Публикации об объекте" defaultOpen>
      <ProjectPublications projectId={d.project.id} />
    </SectionDisclosure>
    {d.notCounted.length > 0 && (
      <SectionDisclosure summary="Не учтено как участие" meta={countText(d.notCounted.length)}>
        <p className={styles.note}>Отрицание, план или слух: такие сообщения в участники не входят.</p>
        <StatementList items={d.notCounted} />
      </SectionDisclosure>
    )}
    <SectionDisclosure summary="Договоры по сообщениям источников" meta={countText(d.contracts.length)} defaultOpen={openIf(d.contracts.length)}>
      <StatementList items={d.contracts} empty="Договоров по объекту в собранных публикациях нет." />
      {d.coParticipationNote && <p className={styles.note}>{d.coParticipationNote}</p>}
    </SectionDisclosure>
    <SectionDisclosure summary="События объекта" meta={countText(d.events.length)} defaultOpen={openIf(d.events.length)}>
      <StatementList items={d.events} empty="Событий объекта в собранных публикациях не найдено." />
    </SectionDisclosure>
    {/* С паспортом ДОМ.РФ строки состояния по событиям нет — история видна и с одной записью. */}
    {d.state.history.length > (d.registry ? 0 : 1) && (
      <SectionDisclosure summary="История состояния" meta={countText(d.state.history.length)}>
        <ProjectStateHistory history={d.state.history} />
      </SectionDisclosure>
    )}
  </div>
);
