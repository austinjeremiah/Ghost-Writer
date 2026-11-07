'use client';

import Purpose from '@/components/sections/Purpose';
import { PROBLEM_ITEMS } from '@/data/content';

/**
 * The second `home-3` instance — "Problems that we solve". Same component as
 * the first panel, different heading and cards.
 */
export default function ProblemsWeSolve() {
  return (
    <Purpose title="Problems" titleAccent="that we solve" items={PROBLEM_ITEMS} />
  );
}
