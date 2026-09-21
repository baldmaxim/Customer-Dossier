// Связи: один центр обхода и схема вокруг него.
//
// Центр живёт в адресе (?company=N или ?project=N) — иначе на схему нельзя
// сослаться и нельзя вернуться кнопкой «Назад». Двух центров одновременно не
// бывает: два узла-основы в одном обходе визуально склеивают несвязанные
// подграфы и читаются как «эти компании связаны».

import { FC } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';

import { CompanyPicker, ProjectPicker } from '../components/EntityPickers';
import { GraphPanel } from '../components/GraphPanel';
import { EmptyState, Section } from '../components/ui/Section';
import styles from './LinksPage.module.css';

export const LinksPage: FC = () => {
  const [params, setParams] = useSearchParams();
  const companyId = Number.parseInt(params.get('company') ?? '', 10);
  const projectId = Number.parseInt(params.get('project') ?? '', 10);
  const hasCompany = Number.isFinite(companyId) && companyId > 0;
  const hasProject = !hasCompany && Number.isFinite(projectId) && projectId > 0;

  /** Смена центра — push в историю: «Назад» возвращает к прошлому узлу. */
  const center = (kind: 'company' | 'project', id: number): void => {
    setParams(kind === 'company' ? { company: String(id) } : { project: String(id) });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Связи</h1>
        <p className={styles.lead}>
          Кто с кем связан по опубликованным утверждениям: участие в объекте, прямой договор,
          корпоративная связь. Путь А → Б → В не означает, что А связана с В: промежуточные звенья
          схема не достраивает.
        </p>
      </header>

      <Section title="Центр схемы">
        <div className={styles.pickers}>
          <CompanyPicker
            label="Компания"
            selected={null}
            onSelect={company => company && center('company', company.id)}
          />
          <ProjectPicker selected={null} onSelect={project => project && center('project', project.id)} />
        </div>
        <p className={styles.note}>
          Центр один. Чтобы посмотреть связи соседа, нажмите на его узел на схеме — она перестроится
          вокруг него, а «Назад» вернёт прежний центр.
        </p>
      </Section>

      {!hasCompany && !hasProject ? (
        <EmptyState>
          Выберите компанию или объект — схема строится вокруг одного центра. Можно прийти и из{' '}
          <Link to="/">каталога компаний</Link>.
        </EmptyState>
      ) : hasCompany ? (
        <GraphPanel
          companyId={companyId}
          defaultOpen
          onRecenter={node => center(node.kind, node.id)}
        />
      ) : (
        <GraphPanel
          projectId={projectId}
          defaultOpen
          onRecenter={node => center(node.kind, node.id)}
        />
      )}
    </div>
  );
};
