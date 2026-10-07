// Главная — «Компании» (ADR-016): портал строится от компании, а не от ленты публикаций.
//
// Строка поиска ищет компании и объекты по названию, ИНН или ОГРН; набран реквизит, которого нет, —
// экран предлагает завести компанию. Без запроса — каталог «Юрлица · Группы · Без ИНН». Общей ленты
// публикаций нет (решение владельца 02.10.2026): публикации — на вкладках компании и объекта.
// Всё состояние экрана — в адресе (q, view, watch, role, sort): «Назад» из карточки возвращает туда же.

import { FC, useCallback, useEffect, useRef, useState } from 'react';

import { CompanyCatalog } from '../components/search/CompanyCatalog';
import { EntityResults } from '../components/search/EntityResults';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchInput } from '../components/ui/SearchInput';
import { useDebounced } from '../hooks/useDebounced';
import { stringParam, useUrlPatch, useUrlState } from '../hooks/useUrlState';
import styles from './CompaniesPage.module.css';

export const CompaniesPage: FC = () => {
  const [q] = useUrlState('q', stringParam());
  const patch = useUrlPatch();

  const [input, setInput] = useState(q);
  const typed = useDebounced(input.trim());

  // Поле → адрес: с задержкой и без новой записи истории — «Назад» ведёт с карточки к поиску,
  // а не перебирает буквы.
  const sent = useRef(q);
  useEffect(() => {
    if (typed === sent.current) return;
    sent.current = typed;
    patch({ q: typed });
  }, [typed, patch]);

  // Адрес → поле: «Назад» или «Вперёд» вернули другой запрос — показать его в поле.
  useEffect(() => {
    if (q === sent.current) return;
    sent.current = q;
    setInput(q);
  }, [q]);

  // Стабильная ссылка — иначе memo у EntityResults не срабатывает и результаты перерисовываются на каждую букву.
  const clearSearch = useCallback((): void => {
    setInput('');
    sent.current = '';
    patch({ q: null });
  }, [patch]);

  const query = q.trim();
  const searching = query.length >= 2;

  return (
    <>
      {/* Заголовок для диктора и вкладки браузера: на экране его роль играют поиск и вкладки каталога. */}
      <PageHeader title="Компании" titleHidden />
      <div className={styles.bar}>
        <SearchInput
          className={styles.search}
          value={input}
          onChange={setInput}
          onClear={clearSearch}
          label="Поиск компании или объекта"
          placeholder="Название, ИНН или ОГРН"
        />
      </div>
      {searching ? <EntityResults query={query} onClear={clearSearch} /> : <CompanyCatalog />}
    </>
  );
};
