// Заявка на доступ (ADR-014, самостоятельная регистрация): с экрана входа — к заявке и обратно без
// перезагрузки, фокус на заголовке нового экрана; правила полей — те же, что на сервере, ошибка — у
// своего поля; успех — «Заявка отправлена»; занятый логин (409) — у поля «Логин». Вход по заявке,
// которую ещё не одобрили или отклонили, объясняется словами.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders, type IFakeRoute } from '../test/render';
import { AuthGate } from './AuthGate';
import { Layout } from './Layout';

const gate = () => (
  <AuthGate>
    <Layout>
      <p>Портал</p>
    </Layout>
  </AuthGate>
);

const anonymous: IFakeRoute = { match: 'GET /api/auth/session', respond: () => ({ status: 200, body: { authRequired: true, authenticated: false } }) };

const heading = (name: string) => screen.findByRole('heading', { name });

const openRegistration = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: 'Отправить заявку' }));
  await heading('Заявка на доступ');
};

const fill = (values: { login?: string; name?: string; password?: string; repeat?: string }): void => {
  if (values.login !== undefined) fireEvent.change(screen.getByLabelText('Логин'), { target: { value: values.login } });
  if (values.name !== undefined) fireEvent.change(screen.getByLabelText('Имя'), { target: { value: values.name } });
  if (values.password !== undefined) fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: values.password } });
  if (values.repeat !== undefined) fireEvent.change(screen.getByLabelText('Пароль ещё раз'), { target: { value: values.repeat } });
};

const submit = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
};

/** Текст ошибки поля — в его описании (aria-describedby), а не где-то на экране. */
const errorOf = (label: string): string => {
  const input = screen.getByLabelText(label);
  const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map(id => document.getElementById(id)?.textContent ?? '').join(' ');
};

describe('заявка на доступ', () => {
  beforeEach(() => document.documentElement.setAttribute('data-theme', 'light'));

  it('вход ↔ заявка без перезагрузки; фокус — на заголовке нового экрана; старый отказ не возвращается', async () => {
    const api = fakeApi([
      anonymous,
      { match: 'POST /api/auth/login', respond: () => ({ status: 401, body: { error: 'Неверный логин или пароль', code: 'bad_credentials' } }) },
    ]);
    renderWithProviders(gate());

    fireEvent.change(await screen.findByLabelText('Логин'), { target: { value: 'ivanov' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Неверный логин или пароль');

    await openRegistration();
    expect(document.activeElement).toBe(await heading('Заявка на доступ'));
    expect(screen.getByLabelText('Пароль').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText('Логин').getAttribute('autocomplete')).toBe('username');

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    const login = await heading('Вход в портал');
    expect(document.activeElement).toBe(login);
    expect(screen.queryByRole('alert')).toBeNull();
    // Переключение не перечитывает сессию и не уходит на сервер.
    expect(api.calls.filter(c => c.url === '/api/auth/session')).toHaveLength(1);
  });

  it('правила — те же, что на сервере: ошибки у полей, фокус на первом неверном, запроса нет', async () => {
    const api = fakeApi([anonymous]);
    renderWithProviders(gate());
    await openRegistration();

    fill({ login: 'Иван', name: '  ', password: 'short', repeat: 'short' });
    submit();
    await waitFor(() => expect(errorOf('Логин')).toContain('Только латинские буквы, цифры, точка, дефис, подчёркивание и @'));
    expect(document.activeElement).toBe(screen.getByLabelText('Логин'));
    expect(errorOf('Имя')).toContain('Укажите имя');
    expect(errorOf('Пароль')).toContain('Пароль — не короче 10 символов');

    fill({ login: 'ivanov', name: 'Иван Иванов', password: 'my-IVANOV-pass', repeat: 'my-IVANOV-pass' });
    submit();
    await waitFor(() => expect(errorOf('Пароль')).toContain('Пароль не должен содержать логин'));
    expect(errorOf('Логин')).not.toContain('Только латинские');

    fill({ password: 'Own-Secret-Pass-9', repeat: 'Own-Secret-Pass-8' });
    submit();
    await waitFor(() => expect(errorOf('Пароль ещё раз')).toContain('Повтор не совпадает с паролем'));
    expect(document.activeElement).toBe(screen.getByLabelText('Пароль ещё раз'));
    expect(api.calls.some(c => c.url === '/api/auth/register')).toBe(false);
  });

  it('успех: логин в нижнем регистре, «Заявка отправлена», «Вернуться ко входу»; пароль не остаётся в форме', async () => {
    const api = fakeApi([anonymous, { match: 'POST /api/auth/register', respond: () => ({ status: 201, body: { status: 'pending' } }) }]);
    renderWithProviders(gate());
    await openRegistration();

    fill({ login: ' IvanoV@Firma.ru ', name: ' Иван Иванов ', password: 'Own-Secret-Pass-9', repeat: 'Own-Secret-Pass-9' });
    submit();

    const done = await heading('Заявка отправлена');
    expect(document.activeElement).toBe(done);
    expect(api.calls.find(c => c.url === '/api/auth/register')?.body).toEqual({
      login: 'ivanov@firma.ru',
      displayName: 'Иван Иванов',
      password: 'Own-Secret-Pass-9',
    });
    expect(document.body.textContent).toContain('Войти можно после одобрения администратором');
    expect(document.body.textContent).toContain('ivanov@firma.ru');
    expect(document.body.textContent).not.toContain('Own-Secret-Pass-9');
    expect(screen.queryByLabelText('Пароль')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Вернуться ко входу' }));
    expect(document.activeElement).toBe(await heading('Вход в портал'));
  });

  it('логин занят (409) — ошибка у поля «Логин», фокус на нём; сбой сети — плашкой', async () => {
    let status = 409;
    fakeApi([
      anonymous,
      {
        match: 'POST /api/auth/register',
        respond: () =>
          status === 409
            ? { status, body: { error: 'Этот логин уже занят', code: 'login_taken' } }
            : { status, body: { error: 'Слишком много попыток, подождите', code: 'rate_limited' } },
      },
    ]);
    renderWithProviders(gate());
    await openRegistration();

    fill({ login: 'ivanov', name: 'Иван Иванов', password: 'Own-Secret-Pass-9', repeat: 'Own-Secret-Pass-9' });
    submit();
    await waitFor(() => expect(errorOf('Логин')).toContain('Этот логин уже занят'));
    expect(document.activeElement).toBe(screen.getByLabelText('Логин'));
    expect(screen.queryByRole('alert')).toBeNull();

    status = 429;
    fill({ login: 'ivanov2' });
    submit();
    expect((await screen.findByRole('alert')).textContent).toContain('Слишком много попыток, подождите');
    expect(errorOf('Логин')).not.toContain('занят');
  });

  it('вход по заявке: «ещё не одобрена» и «отклонена» — словами, экран входа остаётся', async () => {
    let code = 'registration_pending';
    fakeApi([
      anonymous,
      {
        match: 'POST /api/auth/login',
        respond: () => ({ status: 403, body: { error: code === 'registration_pending' ? 'Заявка ещё не одобрена администратором' : 'Заявка отклонена администратором', code } }),
      },
    ]);
    renderWithProviders(gate());

    fireEvent.change(await screen.findByLabelText('Логин'), { target: { value: 'ivanov' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Own-Secret-Pass-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    const pending = await screen.findByRole('alert');
    expect(pending.textContent).toContain('Заявка ещё не одобрена');
    expect(pending.textContent).toContain('отправлять заявку заново не нужно');

    code = 'registration_rejected';
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Own-Secret-Pass-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Заявка отклонена'));
    expect(screen.getByRole('alert').textContent).toContain('свяжитесь');
    expect(screen.queryByText('Портал')).toBeNull();
  });
});
