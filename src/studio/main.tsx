import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import '@/index.css';

/**
 * SPA 的進入點。掛載點由 server 的殼提供（`handler.ts` 的 SHELL），
 * 沒有它就是殼與 bundle 對不上，早點大聲壞掉比默默空白好。
 */
const root = document.getElementById('root');
if (root === null) throw new Error('找不到 #root —— SPA 的殼與 bundle 對不上');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
