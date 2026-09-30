// Корень маршрутов: тосты и подтверждения доступны везде (и на экране входа), дальше —
// вход (AuthGate) и оболочка (Layout с <Outlet/>). ScrollRestoration: «Назад» возвращает
// прокрутку, новый переход начинается сверху; смена параметров адреса прокрутку не трогает
// (useUrlState ставит preventScrollReset).

import { FC } from 'react';
import { ScrollRestoration } from 'react-router-dom';

import { AuthGate } from './AuthGate';
import { Layout } from './Layout';
import { ConfirmProvider } from './ui/ConfirmProvider';
import { ToastProvider } from './ui/ToastProvider';
import { UpdatePrompt } from './UpdatePrompt';

export const AppRoot: FC = () => (
  <ToastProvider>
    <ConfirmProvider>
      <AuthGate>
        <Layout />
      </AuthGate>
      <ScrollRestoration />
      <UpdatePrompt />
    </ConfirmProvider>
  </ToastProvider>
);
