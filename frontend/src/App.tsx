import { FC } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout';
import { UpdatePrompt } from './components/UpdatePrompt';
import { useSession } from './hooks/useSession';
import { DOSSIER_UI_ENABLED } from './lib/features';
import { AdminPage } from './pages/AdminPage';
import { CasePage } from './pages/CasePage';
import { CasesPage } from './pages/CasesPage';
import { CompanyPage } from './pages/CompanyPage';
import { ContractorsPage } from './pages/ContractorsPage';
import { DocumentPage } from './pages/DocumentPage';
import { LoginPage } from './pages/LoginPage';
import { ProjectPage } from './pages/ProjectPage';
import { SnapshotPage } from './pages/SnapshotPage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';
import { SearchPage } from './pages/SearchPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Данные обновляются раз в 10 минут пересчётом метрик — рефетч на каждый
      // фокус окна только дёргает БД без пользы.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/** Досье и управление доступны только после входа оператора. */
const AuthGate: FC = () => {
  const session = useSession();

  if (session.isLoading) return null;
  if (!session.authenticated) {
    return <LoginPage onLogin={session.login} error={session.loginError} pending={session.isLoggingIn} />;
  }

  return (
    <Layout onLogout={() => void session.logout()}>
      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/company/:id" element={<CompanyPage />} />
        <Route path="/contractors" element={<ContractorsPage />} />
        <Route path="/documents/:id" element={<DocumentPage />} />
        <Route path="/admin" element={<AdminPage />} />
        {/* Рабочее досье (этап 08A). Откат — VITE_DOSSIER_UI=false: маршруты скрыты, обращения в базе сохраняются. */}
        {DOSSIER_UI_ENABLED && <Route path="/cases" element={<CasesPage />} />}
        {DOSSIER_UI_ENABLED && <Route path="/cases/:id" element={<CasePage />} />}
        {DOSSIER_UI_ENABLED && <Route path="/projects/:id" element={<ProjectPage />} />}
        {DOSSIER_UI_ENABLED && <Route path="/review" element={<ReviewQueuePage />} />}
        {DOSSIER_UI_ENABLED && <Route path="/snapshots/:id" element={<SnapshotPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
};

export const App: FC = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthGate />
      <UpdatePrompt />
    </BrowserRouter>
  </QueryClientProvider>
);
