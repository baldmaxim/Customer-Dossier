// Поля формы: метка связана с контролом, подсказка и ошибка — через aria-describedby,
// ошибка — aria-invalid; флажок — строкой с подписью; поиск — с кнопкой очистки и Esc; TextInput с onClear — крестик.

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './Checkbox';
import { Field } from './Field';
import { SearchInput } from './SearchInput';
import { Select } from './Select';
import { Textarea } from './Textarea';
import { TextInput } from './TextInput';

describe('Field', () => {
  it('метка, подсказка и ошибка связаны с полем', () => {
    render(
      <Field label="Логин" hint="как в письме администратора" error="Логин не найден" required>
        {control => <TextInput {...control} defaultValue="ivanov" />}
      </Field>,
    );
    const input = screen.getByLabelText(/Логин/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.hasAttribute('required')).toBe(true);
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent);
    expect(described).toEqual(['Логин не найден', 'как в письме администратора']);
  });

  it('без ошибки нет aria-invalid; скрытая метка всё равно даёт имя', () => {
    render(
      <Field label="Источник" labelHidden>
        {control => (
          <Select {...control} defaultValue="all">
            <option value="all">Все источники</option>
          </Select>
        )}
      </Field>,
    );
    const select = screen.getByRole('combobox', { name: 'Источник' });
    expect(select.hasAttribute('aria-invalid')).toBe(false);
  });

  it('Textarea принимает атрибуты поля', () => {
    render(<Field label="Текст публикации">{control => <Textarea {...control} />}</Field>);
    expect(screen.getByRole('textbox', { name: 'Текст публикации' }).tagName).toBe('TEXTAREA');
  });
});

describe('Checkbox', () => {
  it('подпись — имя, подсказка — описание, onChange получает boolean', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Только с публикациями" hint="без них роль не подтверждена" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Только с публикациями' });
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe('без них роль не подтверждена');
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

const SearchHarness = () => {
  const [q, setQ] = useState('мост');
  return <SearchInput label="Поиск компаний и объектов" value={q} onChange={setQ} placeholder="Название" />;
};

describe('SearchInput', () => {
  it('поле поиска с именем; «Очистить поиск» очищает и возвращает фокус в поле', () => {
    render(<SearchHarness />);
    const input = screen.getByRole('searchbox', { name: 'Поиск компаний и объектов' }) as HTMLInputElement;
    expect(input.value).toBe('мост');
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole('button', { name: 'Очистить поиск' })).toBeNull();
  });

  it('Esc очищает непустое поле', () => {
    render(<SearchHarness />);
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
  });
});

const ClearableHarness = () => {
  const [value, setValue] = useState('ivanov');
  return (
    <TextInput
      aria-label="Логин"
      value={value}
      onChange={e => setValue(e.target.value)}
      onClear={() => setValue('')}
      clearLabel="Очистить логин"
    />
  );
};

describe('TextInput onClear', () => {
  it('крестик у непустого поля очищает его и оставляет фокус; у пустого крестика нет', () => {
    render(<ClearableHarness />);
    const input = screen.getByLabelText('Логин') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Очистить логин' }));
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole('button', { name: 'Очистить логин' })).toBeNull();
  });
});
