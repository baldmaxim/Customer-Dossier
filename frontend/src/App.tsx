import { FC } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout';
import { UpdatePrompt } from './components/UpdatePrompt';
import { AdminPage } from './pages/AdminPage';
import { CompanyPage } from './pages/CompanyPage';
import { ContractorsPage } from './pages/ContractorsPage';
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

export const App: FC = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/company/:id" element={<CompanyPage />} />
          <Route path="/contractors" element={<ContractorsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <UpdatePrompt />
    </BrowserRouter>
  </QueryClientProvider>
);
