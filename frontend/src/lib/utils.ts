import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Class-name joiner used by the shadcn/magicui components in `components/ui`. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
