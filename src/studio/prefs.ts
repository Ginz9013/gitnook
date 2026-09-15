import type { Status } from '@/api';
import { isStatus } from '@/statuses';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const THEME_KEY = 'nook.studio.theme';
const COLLAPSED_KEY = 'nook.studio.collapsed';
const ACTIVE_VIEW_KEY = 'nook.studio.activeView';
const SIDEBAR_OPEN_KEY = 'nook.studio.sidebarOpen';

const THEMES: readonly string[] = ['light', 'dark', 'system'];

/** 頂層切換：Issues 的看板，或 Decisions 的扁平清單。 */
export type ActiveView = 'issues' | 'decisions';

const ACTIVE_VIEWS: readonly string[] = ['issues', 'decisions'];

/**
 * 讀主題偏好。**任何讀不懂的值都退回 `'system'`，絕不拋。**
 *
 * `localStorage` 是使用者的瀏覽器說了算：手改過的一格、或是舊版留下的格式，
 * 都不該讓整個看板開不起來。這裡不做 `JSON.parse` —— 偏好本身就是那三個
 * 字串之一，存成裸字串則「壞掉的值」與「不認得的值」是同一條路。
 */
export function readTheme(s: PrefStorage): ThemePreference {
  const raw = s.getItem(THEME_KEY);
  return raw !== null && THEMES.includes(raw) ? (raw as ThemePreference) : 'system';
}

export function writeTheme(s: PrefStorage, p: ThemePreference): void {
  s.setItem(THEME_KEY, p);
}

/**
 * 讀頂層視圖偏好。**任何讀不懂的值都退回 `'issues'`，絕不拋** —— 同 `readTheme`
 * 的既有模式：`localStorage` 是使用者瀏覽器說了算，手改過的一格或舊版留下的
 * 格式都不該讓整個 studio 開不起來，這一格甚至決定了開場要掛哪一個
 * composition root（`App.tsx` 一次只掛一個），讀壞了更不能連畫面都不見。
 */
export function readActiveView(s: PrefStorage): ActiveView {
  const raw = s.getItem(ACTIVE_VIEW_KEY);
  return raw !== null && ACTIVE_VIEWS.includes(raw) ? (raw as ActiveView) : 'issues';
}

export function writeActiveView(s: PrefStorage, v: ActiveView): void {
  s.setItem(ACTIVE_VIEW_KEY, v);
}

/**
 * 讀側邊欄開合偏好。**讀不懂就是展開**（同其餘偏好「壞掉的值不該讓畫面
 * 消失」的既有規則），因為收合是省空間用的，預設值應該是資訊量較多的那一種。
 *
 * shadcn 的 Sidebar 原本用 cookie 存這一格（為了 SSR 時第一幀就對），但這裡
 * 是純前端的 SPA，沒有 SSR 這個前提——沿用這個檔案既有的 `localStorage` 模式，
 * 不必為了一個不存在的情境多一種持久化機制。
 */
export function readSidebarOpen(s: PrefStorage): boolean {
  return s.getItem(SIDEBAR_OPEN_KEY) !== 'false';
}

export function writeSidebarOpen(s: PrefStorage, open: boolean): void {
  s.setItem(SIDEBAR_OPEN_KEY, String(open));
}

/**
 * 偏好 → `<html>` 上那個 class。`'system'` 是唯一會去看
 * `prefers-color-scheme` 的值；明講的亮／暗蓋過作業系統。
 */
export function resolveTheme(p: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  if (p === 'system') return systemDark ? 'dark' : 'light';
  return p;
}

/**
 * 讀折疊起來的欄位。**壞掉的值退回空集合（全部展開），壞掉的項目逐項丟掉。**
 *
 * 逐項而不是整份作廢：一個被改壞、或是舊版留下的欄位名字，不該讓其餘七欄的
 * 偏好一起消失。八個 Status 是固定的（ADR-0003），所以「認不認得」是一個
 * 純粹的成員判斷，而 `@/statuses` 的 `isStatus` 就是 studio 這一側唯一那份 ——
 * 這裡不再自己抄一個：兩份成員判斷會分歧，而分歧的樣子是「看板認得的欄位，
 * 偏好讀不回來」。
 */
export function readCollapsed(s: PrefStorage): ReadonlySet<Status> {
  const raw = s.getItem(COLLAPSED_KEY);
  if (raw === null) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  return new Set(parsed.filter(isStatus));
}

export function writeCollapsed(s: PrefStorage, c: ReadonlySet<Status>): void {
  s.setItem(COLLAPSED_KEY, JSON.stringify([...c]));
}
