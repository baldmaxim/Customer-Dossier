// Главная: строка поиска и переключатель «Компании / Публикации».
//
// Поиск меняет смысл вместе с переключателем: в «Компаниях» это названия компаний и
// объектов, в «Публикациях» — слово из текста, канал или имя компании в посте. Всё
// состояние экрана — в адресе (view, q, фильтры каталога role/sort/all, открытый пост post):
// «Назад» из карточки возвращает туда же, ссылкой на поиск можно поделиться.

import { FC, useEffect, useRef, useState } from 'react';

import { CompanyCatalog } from '../components/search/CompanyCatalog';
import { EntityResults } from '../components/search/EntityResults';
import { PublicationFeed } from '../components/search/PublicationFeed';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchInput } from '../components/ui/SearchInput';
import { Segmented } from '../components/ui/Segmented';
import { useDebounced } from '../hooks/useDebounced';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { enumParam, stringParam, useUrlPatch, useUrlState } from '../hooks/useUrlState';
import { MQ } from '../lib/media';
import styles from './SearchPage.module.css';

type View = 'companies' | 'publications';

const VIEW_VALUES: readonly View[] = ['companies', 'publications'];

const VIEWS: ReadonlyArray<{ value: View; label: string; hint: string }> = [
  { value: 'companies', label: 'Компании', hint: 'каталог компаний; поиск — по компаниям и объектам' },
  { value: 'publications', label: 'Публикации', hint: 'лента и поиск по тексту постов' },
];

const COPY: Record<View, { title: string; label: string; placeholder: string }> = {
  companies: { title: 'Компании', label: 'Поиск компании или объекта', placeholder: 'Компания или объект' },
  publications: { title: 'Публикации', label: 'Поиск по публикациям', placeholder: 'Слово, канал или компания' },
};

export const SearchPage: FC = () => {
  const [view] = useUrlState('view', enumParam(VIEW_VALUES, 'companies'));
  const [q] = useUrlState('q', stringParam());
  const patch = useUrlPatch();
  const wide = useMediaQuery(MQ.sm);

  const [input, setInput] = useState(q);
  const typed = useDebounced(input.trim());

  // Поле → адрес: с задержкой и без новой записи истории — «Назад» ведёт с карточки к
  // поиску, а не перебирает буквы. Новый запрос закрывает открытый пост: его может не
  // оказаться в новой выдаче.
  const sent = useRef(q);
  useEffect(() => {
    if (typed === sent.current) return;
    sent.current = typed;
    patch({ q: typed, post: null });
  }, [typed, patch]);

  // Адрес → поле: «Назад» или «Вперёд» вернули другой запрос — показать его в поле.
  useEffect(() => {
    if (q === sent.current) return;
    sent.current = q;
    setInput(q);
  }, [q]);

  const switchView = (next: View): void => {
    patch({ view: next === 'companies' ? null : next, post: null }, { history: 'push' });
  };

  const clearSearch = (): void => {
    setInput('');
    sent.current = '';
    patch({ q: null, post: null });
  };

  const query = q.trim();
  const searching = query.length >= 2;
  const copy = COPY[view];

  return (
    <>
      {/* Заголовок для диктора и вкладки браузера: на экране его роль играет переключатель. */}
      <PageHeader title={copy.title} titleHidden />
      <div className={styles.bar}>
        <SearchInput
          className={styles.search}
          value={input}
          onChange={setInput}
          onClear={clearSearch}
          label={copy.label}
          placeholder={copy.placeholder}
        />
        <Segmented label="Что показать" items={VIEWS} value={view} onChange={switchView} size="md" fill={!wide} />
      </div>

      {view === 'companies' ? (
        searching ? (
          <EntityResults query={query} onClear={clearSearch} />
        ) : (
          <CompanyCatalog />
        )
      ) : (
        <PublicationFeed query={searching ? query : ''} />
      )}
    </>
  );
};
