// Действия в строке источника: куда посмотреть его публикации и разборы, проверить сайт,
// удалить пустой источник. «Удалить» есть только у источника без публикаций — у остальных
// сервер отказал бы, и кнопка в каждой строке была лишь красным шумом рядом с переключателем.

import { FC } from 'react';

import type { ISourceRow } from '../../api/types';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Cluster } from '../ui/Cluster';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { canDeleteSource, isSourceEnabled, sourceName, type ISourceActions } from './useSourceActions';
import styles from './Sources.module.css';

interface ISourceRowActionsProps {
  source: ISourceRow;
  actions: ISourceActions;
}

export const SourceRowActions: FC<ISourceRowActionsProps> = ({ source, actions }) => {
  const name = sourceName(source);
  // Поиск по публикациям находит и название канала: так открываются его посты в ленте.
  const publications = `/?view=publications&q=${encodeURIComponent(source.title)}`;
  const hidden = <VisuallyHidden> «{name}»</VisuallyHidden>;
  return (
    <Cluster gap={[1, 3]}>
      <ButtonLink to={publications} size="sm" variant="link" className={styles.link}>
        Публикации{hidden}
      </ButtonLink>
      <ButtonLink to={`/admin/process?source=${source.id}`} size="sm" variant="link" className={styles.link}>
        Разборы{hidden}
      </ButtonLink>
      {source.kind === 'website' && isSourceEnabled(source) && (
        <Button
          size="sm"
          loading={actions.isProbing(source)}
          hint="Одна страница, до трёх записей — ничего не сохраняет"
          onClick={() => actions.probe(source)}
        >
          Проверить сайт{hidden}
        </Button>
      )}
      {canDeleteSource(source) && (
        <Button size="sm" variant="ghost" icon="trash" loading={actions.isRemoving(source)} onClick={() => void actions.remove(source)}>
          Удалить{hidden}
        </Button>
      )}
    </Cluster>
  );
};
