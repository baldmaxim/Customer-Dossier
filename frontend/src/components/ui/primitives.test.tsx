// Остальные примитивы: роли, имена и состояния — без снапшотов.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { ButtonLink } from './ButtonLink';
import { Callout } from './Callout';
import { Card } from './Card';
import { CardList } from './CardList';
import { CardListItem } from './CardListItem';
import { DescriptionList } from './DescriptionList';
import { Cluster } from './Cluster';
import { Disclosure } from './Disclosure';
import { EmptyState } from './EmptyState';
import { Grid } from './Grid';
import { Icon } from './Icon';
import { Loading } from './Loading';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { Segmented } from './Segmented';
import { Skeleton } from './Skeleton';
import { Stack } from './Stack';
import { Switch } from './Switch';
import { TableScroll } from './TableScroll';
import { VisuallyHidden } from './VisuallyHidden';

afterEach(() => {
  document.title = 'Досье Заказчика';
});

describe('Button', () => {
  it('loading: занято, повторное нажатие не срабатывает, фокус и имя остаются', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Сохранить
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Сохранить' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('иконка не меняет доступное имя', () => {
    render(
      <Button icon="plus" iconEnd="chevron">
        Добавить канал
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Добавить канал' })).toBeTruthy();
  });
});

describe('ButtonLink', () => {
  it('настоящая ссылка в виде кнопки', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/links?company=7" icon="links">
          Схема связей
        </ButtonLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Схема связей' }).getAttribute('href')).toBe('/links?company=7');
  });
});

describe('Icon', () => {
  it('без подписи — декоративная, с подписью — изображение с именем', () => {
    render(
      <>
        <Icon name="search" />
        <Icon name="warning" label="Внимание" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Внимание' })).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});

describe('Callout', () => {
  it('ошибка объявляется сразу (alert), пояснение — без объявления', () => {
    render(
      <>
        <Callout tone="danger" title="Не удалось загрузить">
          Нет соединения с API
        </Callout>
        <Callout tone="info">Каталог считается раз в 10 минут</Callout>
      </>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Не удалось загрузить');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('live="polite" — role="status"; крестик закрывает', () => {
    const onClose = vi.fn();
    render(
      <Callout tone="success" live="polite" onClose={onClose}>
        Сохранено
      </Callout>,
    );
    expect(screen.getByRole('status').textContent).toContain('Сохранено');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyState, Loading, Skeleton', () => {
  it('пусто — словами и с действием', () => {
    render(<EmptyState title="Ничего не найдено" action={<Button>Сбросить фильтр</Button>}>Проверьте написание.</EmptyState>);
    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
    expect(screen.getByText('Проверьте написание.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сбросить фильтр' })).toBeTruthy();
  });

  it('загрузка — role="status" с подписью; скелет скрыт от диктора', () => {
    render(
      <Loading label="Загружаю компании…">
        <Skeleton lines={3} />
      </Loading>,
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Загружаю компании…');
    expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('PageHeader', () => {
  it('один h1 с tabIndex=-1 и заголовок вкладки браузера', () => {
    render(<PageHeader eyebrow="Компания" title="ООО «Мостострой-11»" meta="Сургут" />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'ООО «Мостострой-11»' });
    expect(h1.getAttribute('tabindex')).toBe('-1');
    expect(document.title).toBe('ООО «Мостострой-11» — Досье Заказчика');
  });

  it('составной title — docTitle строкой', () => {
    render(<PageHeader title={<span>Связи: ООО «Мост»</span>} docTitle="Связи" />);
    expect(document.title).toBe('Связи — Досье Заказчика');
  });
});

describe('Section и уровни заголовков', () => {
  it('раздел — h2, раздел внутри раздела — h3', () => {
    render(
      <Section title="Подробно">
        <Section title="Реестр">
          <p>поля</p>
        </Section>
      </Section>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Подробно' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Реестр' })).toBeTruthy();
  });
});

describe('Disclosure', () => {
  it('summary раскрывает содержимое; заголовок раздела остаётся заголовком', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <Disclosure summary="Технические подробности" level={2} onToggle={onToggle}>
        <p>отпечаток</p>
      </Disclosure>,
    );
    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(screen.getByRole('heading', { level: 2, name: 'Технические подробности' })).toBeTruthy();
    fireEvent.click(container.querySelector('summary') as HTMLElement);
    expect(details?.open).toBe(true);
  });
});

describe('DescriptionList', () => {
  it('подписи и значения парами, пустое — прочерком', () => {
    render(
      <DescriptionList
        items={[
          { label: 'ИНН', value: '7801234567' },
          { label: 'КПП', value: null },
        ]}
      />,
    );
    const terms = screen.getAllByRole('term').map(t => t.textContent);
    const defs = screen.getAllByRole('definition').map(d => d.textContent);
    expect(terms).toEqual(['ИНН', 'КПП']);
    expect(defs).toEqual(['7801234567', '—']);
  });
});

describe('Segmented', () => {
  it('группа с именем, выбранный — aria-pressed', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Сортировка"
        items={[
          { value: 'projects', label: 'По числу объектов' },
          { value: 'name', label: 'По названию' },
        ]}
        value="projects"
        onChange={onChange}
      />,
    );
    const group = screen.getByRole('group', { name: 'Сортировка' });
    expect(within(group).getByRole('button', { name: 'По числу объектов' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'По названию' }));
    expect(onChange).toHaveBeenCalledWith('name');
  });
});

describe('Switch', () => {
  it('роль switch и состояние словом', () => {
    const onChange = vi.fn();
    render(<Switch label="Сбор канала Стройвестник" checked={false} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Сбор канала Стройвестник' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.textContent).toContain('выключен');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('TableScroll', () => {
  it('подпись таблицы — caption (для диктора по умолчанию)', () => {
    render(
      <TableScroll caption="Компании каталога" label="Компании">
        <thead>
          <tr>
            <th>Компания</th>
            <th className="num">Объектов</th>
          </tr>
        </thead>
      </TableScroll>,
    );
    expect(screen.getByRole('table', { name: 'Компании каталога' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Объектов' }).className).toContain('num');
  });
});

describe('CardList', () => {
  it('карточка-ссылка ведёт на запись, действие — отдельная цель', () => {
    render(
      <MemoryRouter>
        <CardList label="Компании">
          <CardListItem to="/company/7" title="ООО «Мост»" meta="Москва · заказчик" aside="3 объ." actions={<Button>Схема</Button>} />
        </CardList>
      </MemoryRouter>,
    );
    const list = screen.getByRole('list', { name: 'Компании' });
    expect(within(list).getByRole('link', { name: 'ООО «Мост»' }).getAttribute('href')).toBe('/company/7');
    expect(within(list).getByRole('button', { name: 'Схема' })).toBeTruthy();
  });
});

describe('раскладка и поверхности', () => {
  it('Stack, Cluster, Grid и Card рендерят нужный элемент и не теряют атрибуты', () => {
    render(
      <Stack as="section" aria-label="Сводка" gap={5}>
        <Cluster as="ul" aria-label="Роли" gap={[1, 2]}>
          <li>заказчик</li>
        </Cluster>
        <Grid min="200px" data-testid="grid">
          <Card as="article" aria-label="Объекты" selected>
            7
          </Card>
        </Grid>
      </Stack>,
    );
    expect(screen.getByRole('region', { name: 'Сводка' }).tagName).toBe('SECTION');
    expect(screen.getByRole('list', { name: 'Роли' }).tagName).toBe('UL');
    expect(screen.getByRole('article', { name: 'Объекты' }).textContent).toBe('7');
    expect(screen.getByTestId('grid').style.getPropertyValue('--grid-min')).toBe('200px');
  });

  it('VisuallyHidden — текст в доступном имени, класс скрытия', () => {
    render(
      <button type="button">
        <Icon name="trash" />
        <VisuallyHidden>Удалить канал</VisuallyHidden>
      </button>,
    );
    const button = screen.getByRole('button', { name: 'Удалить канал' });
    expect(button.querySelector('.visually-hidden')?.textContent).toBe('Удалить канал');
  });
});
