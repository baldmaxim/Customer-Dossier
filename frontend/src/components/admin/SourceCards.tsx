// Источники карточками — на телефоне и планшете. В таблице на 360px были видны только название
// и переключатель: срок сбора обрезан, состояние и действия — за краем. В карточке всё
// одной колонкой, действия — внизу отдельными целями нажатия.

import { FC } from 'react';

import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { Grid } from '../ui/Grid';
import { SourceCollectControls } from './SourceCollectControls';
import { SourceName } from './SourceName';
import { SourceRowActions } from './SourceRowActions';
import { SourceStatus } from './SourceStatus';
import type { ISourcesListProps } from './SourcesTable';
import { isSourceEnabled } from './useSourceActions';

export const SourceCards: FC<ISourcesListProps> = ({ sources, actions, label }) => (
  <CardList label={label}>
    {sources.map(s => (
      <CardListItem key={s.id} title={<SourceName source={s} />} actions={<SourceRowActions source={s} actions={actions} />}>
        {/* На планшете — две колонки (сбор | состояние), на телефоне — одна. */}
        <Grid min="16rem" gap={3}>
          <SourceCollectControls source={s} actions={actions} />
          <SourceStatus source={s} enabled={isSourceEnabled(s)} />
        </Grid>
      </CardListItem>
    ))}
  </CardList>
);
