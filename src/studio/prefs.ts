import type { Status } from '@/api';
import { isStatus } from '@/statuses';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const THEME_KEY = 'nook.studio.theme';
const COLLAPSED_KEY = 'nook.studio.collapsed';

const THEMES: readonly string[] = ['light', 'dark', 'system'];

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
