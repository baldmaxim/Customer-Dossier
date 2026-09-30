// Сброс пароля пользователю — в окне: сначала пароль (сгенерирован, можно заменить), после
// сброса — он же для передачи пользователю. Сброс снимает блокировку входа, закрывает все
// входы пользователя, а при следующем входе пароль придётся сменить.

import { FC, FormEvent, useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IUserRow } from '../../../api/types';
import { generatePassword } from '../../../lib/generatePassword';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field } from '../../ui/Field';
import { Stack } from '../../ui/Stack';
import { TextInput } from '../../ui/TextInput';
import { Callout } from '../../ui/Callout';
import { actionError } from '../actionError';
import formStyles from '../Forms.module.css';
import { IssuedPassword } from './IssuedPassword';
import styles from './Users.module.css';

interface IPasswordResetDialogProps {
  /** Кому сбросить; null — окно закрыто. */
  user: IUserRow | null;
  onClose: () => void;
}

export const PasswordResetDialog: FC<IPasswordResetDialogProps> = ({ user, onClose }) => {
  const queryClient = useQueryClient();
  const formId = useId();
  const [shown, setShown] = useState<IUserRow | null>(user);
  const [password, setPassword] = useState(() => generatePassword());
  const [issued, setIssued] = useState<string | null>(null);
  // Отказ — плашкой в окне: тост под подложкой открытого окна не виден.
  const [error, setError] = useState<string | null>(null);
  if (user !== null && user !== shown) setShown(user);

  // Новое открытие — новый пароль и снова первый шаг.
  useEffect(() => {
    if (user === null) return;
    setPassword(generatePassword());
    setIssued(null);
    setError(null);
  }, [user]);

  const reset = useMutation({
    mutationFn: ({ target, value }: { target: IUserRow; value: string }) =>
      api.post<IUserRow>(`/api/users/${target.id}/password`, { password: value }),
    onSuccess: (_updated, { value }) => {
      setError(null);
      setIssued(value);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['auth-events'] });
    },
    onError: (err: Error) => setError(actionError(err)),
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (shown && password !== '') reset.mutate({ target: shown, value: password });
  };

  return (
    <Dialog
      open={user !== null}
      onClose={onClose}
      title={shown ? `Сбросить пароль: ${shown.displayName}` : 'Сбросить пароль'}
      closeOnBackdrop={false}
      footer={
        issued !== null ? (
          <Button variant="primary" onClick={onClose}>
            Готово
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" form={formId} variant="danger-solid" loading={reset.isPending} disabled={password === ''}>
              Сбросить пароль
            </Button>
          </>
        )
      }
    >
      {shown && issued !== null ? (
        <IssuedPassword login={shown.login} password={issued} />
      ) : (
        shown && (
          <Stack as="form" id={formId} gap={3} onSubmit={submit}>
            <p className={styles.note}>
              Все входы <strong>{shown.login}</strong> закроются, при следующем входе пользователь задаст свой пароль.
            </p>
            <div className={formStyles.inline}>
              <Field label={`Новый пароль: ${shown.login}`} className={formStyles.grow}>
                {control => (
                  <TextInput
                    {...control}
                    className={formStyles.mono}
                    autoComplete="off"
                    spellCheck={false}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                )}
              </Field>
              <Button onClick={() => setPassword(generatePassword())}>Другой</Button>
            </div>
            {error && <Callout tone="danger">{error}</Callout>}
          </Stack>
        )
      )}
    </Dialog>
  );
};
