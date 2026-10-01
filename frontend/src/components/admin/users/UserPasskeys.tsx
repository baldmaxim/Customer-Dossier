// Ключи доступа пользователя — для администратора: какие есть, когда ими входили, «Убрать» с подтверждением.
// Добавляет ключ только сам пользователь в профиле (с паролем): администратор ключей не выдаёт.
// Ответ — в самом блоке: список обновляется, отказ — плашкой.

import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IPasskeyRow, IUserRow } from '../../../api/types';
import { describeLoadError } from '../../../lib/loadError';
import { PasskeyList } from '../../passkeys/PasskeyList';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { useConfirm } from '../../ui/confirm';
import { EmptyState } from '../../ui/EmptyState';
import { Loading } from '../../ui/Loading';
import { Stack } from '../../ui/Stack';
import { actionError } from '../actionError';

export const UserPasskeys: FC<{ user: IUserRow }> = ({ user }) => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const listQuery = useQuery({
    queryKey: ['users', user.id, 'passkeys'],
    queryFn: () => api.get<{ enabled: boolean; items: IPasskeyRow[] }>(`/api/users/${user.id}/passkeys`),
  });

  const revoke = useMutation({
    mutationFn: (passkey: IPasskeyRow) => api.post(`/api/users/${user.id}/passkeys/${passkey.id}/revoke`),
    onSuccess: () => {
      setError(null);
      // ['users'] — префикс и списка, и этого блока: число ключей в списке тоже обновится.
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['auth-events'] });
    },
    onError: (err: Error) => setError(actionError(err)),
  });

  const askRevoke = async (passkey: IPasskeyRow): Promise<void> => {
    const ok = await confirm({
      title: `Убрать ключ «${passkey.name}»?`,
      body: `${user.displayName} не сможет входить этим ключом. Открытые входы останутся — их закрывают отдельно.`,
      confirmLabel: 'Убрать ключ',
      tone: 'danger',
    });
    if (ok) revoke.mutate(passkey);
  };

  if (listQuery.isLoading) return <Loading label="Загружаю ключи…" />;
  if (listQuery.isError) {
    return (
      <Callout tone="danger" title="Ключи не загрузились" action={<Button onClick={() => void listQuery.refetch()}>Повторить</Button>}>
        {describeLoadError(listQuery.error)}
      </Callout>
    );
  }
  const data = listQuery.data;
  if (data && !data.enabled) return <EmptyState size="sm">Вход по ключу доступа на этом адресе портала не настроен.</EmptyState>;
  const items = data?.items ?? [];
  if (items.length === 0) return <EmptyState size="sm">Ключей нет — пользователь входит по паролю.</EmptyState>;

  return (
    <Stack gap={3}>
      {error && (
        <Callout tone="danger" onClose={() => setError(null)}>
          {error}
        </Callout>
      )}
      <PasskeyList items={items} onRemove={p => void askRevoke(p)} removingId={revoke.isPending ? (revoke.variables?.id ?? null) : null} />
    </Stack>
  );
};
