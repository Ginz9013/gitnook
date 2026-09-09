import { useCallback, useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { readTheme, resolveTheme, writeTheme } from '@/prefs';
import type { ThemePreference } from '@/prefs';

/**
 * 亮／暗／跟隨系統的三態切換。
 *
 * **可判定的部分不住在這裡** —— 「壞掉的偏好怎麼辦」與「跟隨系統時算出哪一個」
 * 都在 `prefs.ts`，有測試（`test/studio/prefs.test.ts`）。這個檔案剩下的是接線：
 * 讀寫 `localStorage`、把 class 掛上 `<html>`、訂閱 `prefers-color-scheme`。
 * React 組件不寫測試（spec.md 的測試策略），所以留在這裡的東西必須少到用看的
 * 就對得完。
 */

const MEDIA = '(prefers-color-scheme: dark)';

const systemDark = (): boolean => window.matchMedia(MEDIA).matches;

/**
 * 把偏好實際套上 `<html>`。**加／拿掉 `.dark` 這件事只有這一個地方會做** ——
 * `main.tsx` 在掛載之前也呼叫它（否則第一幀會閃一下亮色），走的是同一條路。
 */
export function applyTheme(p: ThemePreference): void {
  document.documentElement.classList.toggle('dark', resolveTheme(p, systemDark()) === 'dark');
}

/** 開場的偏好 —— `localStorage` 讀不懂就是 `'system'`，不會拋。 */
export const storedTheme = (): ThemePreference => readTheme(window.localStorage);

const OPTIONS = [
  { value: 'light', label: '亮色', Icon: Sun },
  { value: 'dark', label: '暗色', Icon: Moon },
  { value: 'system', label: '跟隨系統', Icon: Monitor },
] as const;

export function ThemeToggle(): React.JSX.Element {
  const [preference, setPreference] = useState<ThemePreference>(storedTheme);

  /**
   * 只有 `'system'` 需要訂閱作業系統 —— 明講的亮／暗不該被系統設定改掉。
   * 訂閱與套用寫在同一個 effect：兩者的觸發條件是同一個偏好，分開兩個
   * effect 只會多出一個「套了但沒訂閱」的中間狀態。
   */
  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system') return;
    const media = window.matchMedia(MEDIA);
    const onChange = (): void => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const choose = useCallback((value: string): void => {
    const p = value as ThemePreference;
    writeTheme(window.localStorage, p);
    setPreference(p);
  }, []);

  const current = OPTIONS.find((o) => o.value === preference) ?? OPTIONS[2];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={`主題：${current.label}`}>
          <current.Icon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={preference} onValueChange={choose}>
          {OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden className="size-4" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
