import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Глобальные стили — первыми: токены и база, поверх них — модули компонентов. Раньше
// index.css подключался последним, и глобальные правила перебивали модули той же
// специфичности (так :focus-visible менял форму пилюль).
import './index.css';
import { App } from './App';
import { purgeSensitiveCaches } from './lib/cachePurge';

// Прежние сборки кэшировали ответы API и шрифты. Удаляем при каждом старте:
// досье не должно читаться из кэша после выхода или смены сборки.
void purgeSensitiveCaches();

const root = document.getElementById('root');
if (!root) throw new Error('Не найден #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
