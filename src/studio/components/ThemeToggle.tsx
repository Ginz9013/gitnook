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
 * 讀寫 `localStorage`、把 class 掛上 `<html>`。
 * React 組件不寫測試（spec.md 的測試策略），所以留在這裡的東西必須少到用看的
 * 就對得完。
 */

/** 作業系統的亮／暗查詢。`main.tsx` 訂閱它，這裡讀它 —— 字串只有一份。 */
export const MEDIA = '(prefers-color-scheme: dark)';

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

/**
 * 三個偏好各自的樣子。**寫成以 `ThemePreference` 為鍵的表而不是陣列** ——
 * 陣列要用 `find` 找，而 `find` 回得出 `undefined`，於是就得補一個永遠走不到
 * 的退路。查表則由型別保證完備：少一個鍵編不過，也就沒有退路要寫。
 */
const OPTIONS: Readonly<Record<ThemePreference, { label: string; Icon: typeof Sun }>> = {
  light: { label: '亮色', Icon: Sun },
  dark: { label: '暗色', Icon: Moon },
  system: { label: '跟隨系統', Icon: Monitor },
};

/** 選單列出來的順序。上面那張表是查詢用的，物件的鍵序不該拿來當版面。 */
const ORDER: readonly ThemePreference[] = ['light', 'dark', 'system'];

export function ThemeToggle(): React.JSX.Element {
  const [preference, setPreference] = useState<ThemePreference>(storedTheme);

  /**
   * 偏好改了就套上去。**訂閱作業系統不在這裡** —— 它在 `main.tsx`，因為
   * 「跟著系統走」是這個頁面的性質，不是這顆按鈕的性質：訂閱掛在組件上時，
   * 組件一 unmount（票 B2 正要把它搬進 header）跟隨系統就靜靜死掉。
   */
  useEffect(() => applyTheme(preference), [preference]);

  const choose = useCallback((value: string): void => {
    const p = value as ThemePreference;
    writeTheme(window.localStorage, p);
    setPreference(p);
  }, []);

  const current = OPTIONS[preference];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={`主題：${current.label}`}>
          <current.Icon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={preference} onValueChange={choose}>
          {ORDER.map((value) => {
            const { label, Icon } = OPTIONS[value];
            return (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon aria-hidden className="size-4" />
                {label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
