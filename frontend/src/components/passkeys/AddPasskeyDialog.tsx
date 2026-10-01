// Добавить ключ доступа: текущий пароль (сервер не даст добавить ключ по одной лишь открытой сессии —
// иначе украденная сессия стала бы постоянным входом), название, затем окно устройства.
// Отказ — плашкой в окне: тост под подложкой открытого окна не виден.

import { FC, FormEvent, useEffect, useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';

import { api } from '../../api/client';
import type { IPasskeyRow } from '../../api/types';
import { createPasskey, isPasskeyCancel, passkeyErrorText, suggestPasskeyName } from '../../lib/passkey';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Stack } from '../ui/Stack';
import { TextInput } from '../ui/TextInput';

/** Как на сервере (auth/passkeys.ts, PASSKEY_NAME_MAX). */
const NAME_MAX = 60;

interface IAddPasskeyDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: (passkey: IPasskeyRow) => void;
}

export const AddPasskeyDialog: FC<IAddPasskeyDialogProps> = ({ open, onClose, onAdded }) => {
  const formId = useId();
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Новое открытие — пустой пароль и название по устройству.
  useEffect(() => {
    if (!open) return;
    setPassword('');
    setName(suggestPasskeyName(navigator.userAgent));
    setError(null);
  }, [open]);

  const add = useMutation({
    mutationFn: async () => {
      const { options } = await api.post<{ options: PublicKeyCredentialCreationOptionsJSON }>('/api/auth/passkeys/options', {
        currentPassword: password,
      });
      const response = await createPasskey(options);
      return api.post<IPasskeyRow>('/api/auth/passkeys', { response, name: name.trim() });
    },
    onSuccess: passkey => {
      setPassword('');
      onAdded(passkey);
    },
    onError: (err: unknown) => {
      setPassword('');
      setError(isPasskeyCancel(err) ? 'Окно ключа доступа закрыто — ключ не добавлен. Введите пароль и попробуйте ещё раз.' : passkeyErrorText(err));
    },
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (password === '' || add.isPending) return;
    setError(null);
    add.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Добавить ключ доступа"
      description="После пароля устройство попросит подтвердить вас лицом, отпечатком или PIN-кодом и сохранит ключ портала."
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" form={formId} variant="primary" loading={add.isPending} disabled={password === ''}>
            Продолжить
          </Button>
        </>
      }
    >
      <Stack as="form" id={formId} gap={3} onSubmit={submit}>
        <Field label="Текущий пароль" hint="Подтверждает, что ключ добавляете именно вы.">
          {control => (
            <TextInput {...control} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          )}
        </Field>
        <Field label="Название" hint="Чтобы отличать ключи: «iPhone», «рабочий ноутбук». Можно оставить пустым.">
          {control => <TextInput {...control} maxLength={NAME_MAX} value={name} onChange={e => setName(e.target.value)} />}
        </Field>
        {error && (
          <Callout tone="danger" live="assertive">
            {error}
          </Callout>
        )}
      </Stack>
    </Dialog>
  );
};
