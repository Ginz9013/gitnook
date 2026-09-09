import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn 的慣例：合併 class 並讓後來的 Tailwind utility 勝出。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
