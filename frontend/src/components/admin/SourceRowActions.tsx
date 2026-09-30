// Действия с источником — рядом тихих кнопок: публикации и разборы источника, подробности
// состояния (окном), проверка сайта, удаление пустого источника.
//
// Где места мало — на телефоне и в таблице уже 1280px, — в строке остаётся одно «Подробнее»:
// окно подробностей несёт все действия (place="dialog"), так что ничего не теряется, а строка
// не переносится и таблица не уходит в прокрутку вбок.
//
// «Удалить» есть только у источника без публикаций — у остальных сервер отказал бы, и кнопка
// в каждой строке была бы лишь красным шумом рядом с переключателем.

import { FC } from 'react';

import type { ISourceRow } from '../../api/types';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { canDeleteSource, isSourceEnabled, sourceName, type ISourceActions } from './useSourceActions';
import styles from './Sources.module.css';

/** row — всё в строке; compact — только «Подробнее»; dialog — всё, кроме «Подробнее», в окне. */
export type SourceActionsPlace = 'row' | 'compact' | 'dialog';

interface ISourceRowActionsProps {
  source: ISourceRow;
  actions: ISourceActions;
  place?: SourceActionsPlace;
}

export const SourceRowActions: FC<ISourceRowActionsProps> = ({ source, actions, place = 'row' }) => {
  const name = sourceName(source);
  // Поиск по публикациям находит и название канала: так открываются его посты в ленте.
  const publications = `/?view=publications&q=${encodeURIComponent(source.title)}`;
  // Чья это кнопка — диктору: в таблице десяток одинаковых «Подробнее». В окне источник назван
  // в заголовке — там уточнение не нужно.
  const of = place === 'dialog' ? null : <VisuallyHidden> «{name}»</VisuallyHidden>;
  const details = (
    <Button size="sm" variant="ghost" onClick={() => actions.openDetails(source)}>
      Подробнее{of}
    </Button>
  );
  if (place === 'compact') return <div className={styles.actions}>{details}</div>;

  const inDialog = place === 'dialog';
  return (
    <div className={styles.actions}>
      <ButtonLink to={publications} size="sm" variant={inDialog ? 'secondary' : 'ghost'}>
        Публикации{of}
      </ButtonLink>
      <ButtonLink to={`/admin/process?source=${source.id}`} size="sm" variant={inDialog ? 'secondary' : 'ghost'}>
        Разборы{of}
      </ButtonLink>
      {!inDialog && details}
      {source.kind === 'website' && isSourceEnabled(source) && (
        <Button
          size="sm"
          variant={inDialog ? 'secondary' : 'ghost'}
          loading={actions.isProbing(source)}
          hint="Одна страница, до трёх записей — ничего не сохраняет"
          onClick={() => actions.probe(source)}
        >
          {inDialog ? 'Проверить сайт' : 'Проверить'}
          {of && <VisuallyHidden> сайт «{name}»</VisuallyHidden>}
        </Button>
      )}
      {canDeleteSource(source) &&
        (inDialog ? (
          <Button
            size="sm"
            variant="danger"
            icon="trash"
            className={styles.danger}
            loading={actions.isRemoving(source)}
            onClick={() => void actions.remove(source)}
          >
            Удалить
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            iconOnly
            aria-label={`Удалить «${name}»`}
            hint="Удалить — публикаций нет"
            loading={actions.isRemoving(source)}
            onClick={() => void actions.remove(source)}
          />
        ))}
    </div>
  );
};
