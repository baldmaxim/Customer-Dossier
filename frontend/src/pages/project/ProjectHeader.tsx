// Шапка объекта: уровень и родитель (ссылкой) над названием, город и очереди под ним, «Схема
// связей» справа — окном. В загрузке и ошибке — та же шапка на том же месте дерева: заголовок h1 не
// пересоздаётся, и фокус, который оболочка поставила на него после перехода, не теряется.

import { FC, Fragment } from 'react';
import { Link } from 'react-router-dom';

import type { IProjectDossier } from '../../api/types';
import { GraphButton } from '../../components/graph/GraphButton';
import { PageHeader } from '../../components/ui/PageHeader';
import { PROJECT_LEVEL_LABELS } from '../../lib/labels';
import styles from '../ProjectPage.module.css';

type HeaderState = 'loading' | 'error' | 'missing' | 'ready';

const levelText = (level: string, label: string | null): string => `${PROJECT_LEVEL_LABELS[level] ?? 'объект'}${label ? ` ${label}` : ''}`;

export const ProjectHeader: FC<{ dossier: IProjectDossier | undefined; state: HeaderState }> = ({ dossier, state }) => {
  if (!dossier || state !== 'ready') {
    // В загрузке заголовок скрыт, а надпись «Объект» держит место; в ошибке заголовок и есть надпись.
    return (
      <PageHeader
        eyebrow={state === 'loading' ? 'Объект' : undefined}
        title={state === 'missing' ? 'Объект не найден' : 'Объект'}
        titleHidden={state === 'loading'}
      />
    );
  }
  const p = dossier.project;
  return (
    <PageHeader
      eyebrow={
        <>
          {levelText(p.level, p.levelLabel)}
          {p.parent && (
            <>
              {' · входит в '}
              <Link to={`/projects/${p.parent.id}`} viewTransition className={styles.eyebrowLink}>
                {p.parent.name}
              </Link>
            </>
          )}
        </>
      }
      title={p.name}
      meta={
        <div className={styles.headerMeta}>
          <span>{p.city ?? 'город в публикациях не указан'}</span>
          {p.children.length > 0 && (
            <span>
              Очереди и корпуса:{' '}
              {p.children.map((c, i) => (
                <Fragment key={c.id}>
                  {i > 0 && ', '}
                  <Link to={`/projects/${c.id}`} viewTransition>
                    {c.levelLabel ? levelText(c.level, c.levelLabel) : c.name}
                  </Link>
                </Fragment>
              ))}
            </span>
          )}
        </div>
      }
      actions={<GraphButton projectId={p.id} icon="links" />}
    />
  );
};
