// Свои ключи доступа (профиль): список, «Добавить ключ доступа», «Убрать» с подтверждением.
// Ключ привязан к адресу портала и живёт на устройстве или в его облаке (iCloud, Google, менеджер паролей);
// портал хранит только открытую часть.

import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IPasskeyRow } from '../../api/types';
import { describeLoadError } from '../../lib/loadError';
import { passkeysSupported } from '../../lib/passkey';
import { actionError } from '../admin/actionError';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { useConfirm } from '../ui/confirm';
import { EmptyState } from '../ui/EmptyState';
import { Loading } from '../ui/Loading';
import { Stack } from '../ui/Stack';
import { AddPasskeyDialog } from './AddPasskeyDialog';
import { PasskeyList } from './PasskeyList';
import styles from './Passkeys.module.css';

const KEY = ['my-passkeys'] as const;

export const PasskeysPanel: FC = () => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const supported = passkeysSupported();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const listQuery = useQuery({ queryKey: KEY, queryFn: () => api.get<{ items: IPasskeyRow[] }>('/api/auth/passkeys') });

  const remove = useMutation({
    mutationFn: (passkey: IPasskeyRow) => api.delete(`/api/auth/passkeys/${passkey.id}`),
    onSuccess: (_r, passkey) => {
      setNotice({ tone: 'success', text: `Ключ «${passkey.name}» убран: войти им больше нельзя.` });
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (err: Error) => {
      setNotice({ tone: 'danger', text: actionError(err) });
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });

  const askRemove = async (passkey: IPasskeyRow): Promise<void> => {
    const ok = await confirm({
      title: `Убрать ключ «${passkey.name}»?`,
      body: 'Войти этим ключом будет нельзя. С устройства он исчезнет сам при следующей попытке или его можно удалить в настройках паролей.',
      confirmLabel: 'Убрать ключ',
      tone: 'danger',
    });
    if (ok) remove.mutate(passkey);
  };

  const items = listQuery.data?.items ?? [];

  return (
    <Stack gap={3}>
      <p className={styles.note}>
        Ключ доступа (passkey) — вход без пароля: устройство подтверждает вас лицом, отпечатком или PIN-кодом. Ключ работает
        только на этом портале, подобрать или выманить его нельзя.
      </p>
      {notice && (
        <Callout tone={notice.tone} live="polite" onClose={() => setNotice(null)}>
          {notice.text}
        </Callout>
      )}
      {listQuery.isLoading && <Loading label="Загружаю ключи…" />}
      {listQuery.isError && (
        <Callout tone="danger" title="Ключи не загрузились" action={<Button onClick={() => void listQuery.refetch()}>Повторить</Button>}>
          {describeLoadError(listQuery.error)}
        </Callout>
      )}
      {listQuery.isSuccess &&
        (items.length === 0 ? (
          <EmptyState size="sm">Ключей пока нет — вход только по паролю.</EmptyState>
        ) : (
          <PasskeyList items={items} onRemove={p => void askRemove(p)} removingId={remove.isPending ? (remove.variables?.id ?? null) : null} />
        ))}
      {supported ? (
        <div>
          <Button icon="plus" onClick={() => setAdding(true)}>
            Добавить ключ доступа
          </Button>
        </div>
      ) : (
        <Callout tone="info">Этот браузер не умеет ключи доступа — добавьте ключ с телефона или из другого браузера.</Callout>
      )}
      <AddPasskeyDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={passkey => {
          setAdding(false);
          setNotice({ tone: 'success', text: `Ключ «${passkey.name}» добавлен. На экране входа — «Войти с ключом доступа».` });
          void queryClient.invalidateQueries({ queryKey: KEY });
        }}
      />
    </Stack>
  );
};
