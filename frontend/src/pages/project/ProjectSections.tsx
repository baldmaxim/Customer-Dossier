// Второстепенное об объекте — под раскрытием: «Не учтено как участие», договоры, события,
// история состояния и схема связей. Схема строится, только когда её раскрыли.

import { FC, useState } from 'react';

import type { IProjectDossier } from '../../api/types';
import { GraphPanel } from '../../components/GraphPanel';
import { StatementList } from '../../components/StatementList';
import { formatCount } from '../../lib/format';
import { ProjectStateHistory } from './ProjectStateHistory';
import { SectionDisclosure } from './SectionDisclosure';
import styles from '../ProjectPage.module.css';

const countText = (n: number): string => (n > 0 ? formatCount(n) : 'нет');

export const ProjectSections: FC<{ dossier: IProjectDossier }> = ({ dossier: d }) => {
  const [graphOpen, setGraphOpen] = useState(false);
  return (
    <div className={styles.sections}>
      {d.notCounted.length > 0 && (
        <SectionDisclosure summary="Не учтено как участие" meta={countText(d.notCounted.length)}>
          <p className={styles.note}>Отрицание, план или слух: такие сообщения в участники не входят.</p>
          <StatementList items={d.notCounted} />
        </SectionDisclosure>
      )}
      <SectionDisclosure summary="Договоры по сообщениям источников" meta={countText(d.contracts.length)}>
        <StatementList items={d.contracts} empty="Договоров по объекту в собранных публикациях нет." />
        {d.coParticipationNote && <p className={styles.note}>{d.coParticipationNote}</p>}
      </SectionDisclosure>
      <SectionDisclosure summary="События объекта" meta={countText(d.events.length)}>
        <StatementList items={d.events} empty="Событий объекта в собранных публикациях не найдено." />
      </SectionDisclosure>
      {d.state.history.length > 1 && (
        <SectionDisclosure summary="История состояния" meta={countText(d.state.history.length)}>
          <ProjectStateHistory history={d.state.history} />
        </SectionDisclosure>
      )}
      <SectionDisclosure summary="Схема связей" open={graphOpen} onToggle={setGraphOpen}>
        {graphOpen && <GraphPanel projectId={d.project.id} defaultOpen title={null} variant="plain" linksPageLink />}
      </SectionDisclosure>
    </div>
  );
};
