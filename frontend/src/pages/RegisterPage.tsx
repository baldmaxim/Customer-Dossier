// Заявка на доступ (ADR-014, самостоятельная регистрация): человек сам задаёт логин, имя и пароль,
// администратор в «Пользователях» одобряет заявку с ролью или отклоняет. До одобрения войти
// нельзя, сессии заявка не создаёт. Правила полей — те же, что на сервере (lib/accountRules.ts);
// сервер всё равно проверяет сам, и его отказ показывается у своего поля.

import { FC, FormEvent, RefObject, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { api, ApiError } from '../api/client';
import { actionError } from '../lib/actionError';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Field } from '../components/ui/Field';
import { Stack } from '../components/ui/Stack';
import { TextInput } from '../components/ui/TextInput';
import { usePageTitle } from '../hooks/usePageTitle';
import { displayNameProblem, loginProblem, normalizeLogin, PASSWORD_MIN_LENGTH, passwordProblem } from '../lib/accountRules';
import { AuthCard } from './AuthCard';

interface IRegisterPageProps {
  /** Назад, к экрану входа. */
  onBack: () => void;
}

type FieldName = 'login' | 'displayName' | 'password' | 'repeat';
type FieldErrors = Partial<Record<FieldName, string>>;

interface IRegistration {
  login: string;
  displayName: string;
  password: string;
}

/** Отказ сервера — у своего поля: занятый логин — у логина, слабый пароль — у пароля. */
const FIELD_OF_CODE: Readonly<Record<string, FieldName>> = {
  login_taken: 'login',
  invalid_login: 'login',
  invalid_name: 'displayName',
  weak_password: 'password',
};

const FIELD_ORDER: readonly FieldName[] = ['login', 'displayName', 'password', 'repeat'];

const fieldOf = (err: unknown): FieldName | undefined =>
  err instanceof ApiError && err.code !== null ? FIELD_OF_CODE[err.code] : undefined;

/** Правила сервера до запроса; login — уже нормализованный, name — без пробелов по краям. */
const validate = (login: string, name: string, password: string, repeat: string): FieldErrors => {
  const errors: FieldErrors = {};
  const badLogin = loginProblem(login);
  if (badLogin) errors.login = badLogin;
  const badName = name === '' ? 'Укажите имя' : displayNameProblem(name);
  if (badName) errors.displayName = badName;
  const weak = passwordProblem(password, badLogin ? '' : login);
  if (weak) errors.password = weak;
  else if (repeat !== password) errors.repeat = repeat === '' ? 'Повторите пароль' : 'Повтор не совпадает с паролем';
  return errors;
};

export const RegisterPage: FC<IRegisterPageProps> = ({ onBack }) => {
  const [login, setLogin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sentAs, setSentAs] = useState<string | null>(null);
  const refs: Record<FieldName, RefObject<HTMLInputElement | null>> = {
    login: useRef<HTMLInputElement>(null),
    displayName: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    repeat: useRef<HTMLInputElement>(null),
  };
  usePageTitle(sentAs === null ? 'Заявка на доступ' : 'Заявка отправлена');

  const showErrors = (next: FieldErrors): void => {
    setErrors(next);
    const first = FIELD_ORDER.find(f => next[f] !== undefined);
    if (first) refs[first].current?.focus();
  };

  const send = useMutation({
    mutationFn: (input: IRegistration) => api.post<{ status: 'pending' }>('/api/auth/register', input),
    onSuccess: (_result, input) => {
      setPassword('');
      setRepeat('');
      setSentAs(input.login);
    },
    onError: (err: Error) => {
      const field = fieldOf(err);
      if (field) showErrors({ [field]: err.message });
    },
  });
  // Общая ошибка (сеть, лимит попыток, защита запроса) — плашкой над кнопкой; полевая — у поля.
  const generalError = send.error && fieldOf(send.error) === undefined ? actionError(send.error) : null;

  const edit =
    (field: FieldName, set: (value: string) => void) =>
    (value: string): void => {
      set(value);
      if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
    };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (send.isPending) return;
    send.reset();
    const normalized = normalizeLogin(login);
    const name = displayName.trim();
    const next = validate(normalized, name, password, repeat);
    if (Object.keys(next).length > 0) {
      showErrors(next);
      return;
    }
    setErrors({});
    send.mutate({ login: normalized, displayName: name, password });
  };

  if (sentAs !== null) {
    return (
      <AuthCard
        title="Заявка отправлена"
        lead={
          <>
            Войти можно после одобрения администратором. Логин — <strong>{sentAs}</strong>, пароль — тот, что вы задали. Чтобы не ждать,
            сообщите администратору портала о заявке.
          </>
        }
      >
        <Button variant="primary" size="lg" block onClick={onBack}>
          Вернуться ко входу
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Заявка на доступ"
      lead="Администратор портала рассмотрит заявку и откроет доступ. Пароль задайте сами — его будете знать только вы."
      footer={
        <>
          <span>Уже есть доступ?</span>
          <Button variant="link" onClick={onBack}>
            Войти
          </Button>
        </>
      }
    >
      <Stack as="form" gap={4} onSubmit={submit}>
        <Field
          label="Логин"
          hint="Латинские буквы, цифры, точка, дефис, подчёркивание, @ — от 3 до 64 знаков. Подойдёт рабочая почта."
          error={errors.login}
        >
          {control => (
            <TextInput
              {...control}
              ref={refs.login}
              size="lg"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={128}
              value={login}
              onChange={e => edit('login', setLogin)(e.target.value)}
            />
          )}
        </Field>
        <Field label="Имя" hint="Имя и фамилия — так вас увидит администратор." error={errors.displayName}>
          {control => (
            <TextInput
              {...control}
              ref={refs.displayName}
              size="lg"
              autoComplete="name"
              maxLength={200}
              value={displayName}
              onChange={e => edit('displayName', setDisplayName)(e.target.value)}
            />
          )}
        </Field>
        <Field label="Пароль" hint={`Не короче ${PASSWORD_MIN_LENGTH} символов и без логина внутри.`} error={errors.password}>
          {control => (
            <TextInput
              {...control}
              ref={refs.password}
              size="lg"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={password}
              onChange={e => edit('password', setPassword)(e.target.value)}
            />
          )}
        </Field>
        <Field label="Пароль ещё раз" error={errors.repeat}>
          {control => (
            <TextInput
              {...control}
              ref={refs.repeat}
              size="lg"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={repeat}
              onChange={e => edit('repeat', setRepeat)(e.target.value)}
            />
          )}
        </Field>
        {generalError && <Callout tone="danger">{generalError}</Callout>}
        <Button type="submit" variant="primary" size="lg" block loading={send.isPending}>
          Отправить заявку
        </Button>
      </Stack>
    </AuthCard>
  );
};
