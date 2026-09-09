import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { ThemeToggle, applyTheme, storedTheme } from '@/components/ThemeToggle';
import '@/index.css';

/**
 * SPA 的進入點。掛載點由 server 的殼提供（`handler.ts` 的 SHELL），
 * 沒有它就是殼與 bundle 對不上，早點大聲壞掉比默默空白好。
 */
const root = document.getElementById('root');
if (root === null) throw new Error('找不到 #root —— SPA 的殼與 bundle 對不上');

/**
 * **在 render 之前先套主題。** 晚一步就是第一幀閃一下亮色再變暗 —— 而那一閃
 * 正是使用者記得的東西。之後的切換由 `ThemeToggle` 自己維持。
 */
applyTheme(storedTheme());

/**
 * 切換器**這一批先固定在右上角**：批 B 的票 B1 會把它搬進 header。
 * 這是知情的兩步 —— 批 A 要能切主題，而 header 是批 B 的事。
 */
createRoot(root).render(
  <StrictMode>
    <div className="fixed top-3 right-3 z-50">
      <ThemeToggle />
    </div>
    <App />
  </StrictMode>,
);
