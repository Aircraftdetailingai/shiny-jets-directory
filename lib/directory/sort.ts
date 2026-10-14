// Globe listing order: more published operating hours, then Google rating,
// then Google review count. Nulls sort last. Plan is not a key.

export function cmpDescNullsLast(a: number | null | undefined, b: number | null | undefined): number {
  const aN = a == null ? null : Number(a);
  const bN = b == null ? null : Number(b);
  if (aN == null && bN == null) return 0;
  if (aN == null) return 1;
  if (bN == null) return -1;
  return bN - aN;
}

export function compareDirectoryDetailers(
  a: {
    operating_hours_per_week?: number | null;
    google_rating?: number | null;
    google_review_count?: number | null;
    company?: string | null;
  },
  b: {
    operating_hours_per_week?: number | null;
    google_rating?: number | null;
    google_review_count?: number | null;
    company?: string | null;
  },
): number {
  const byOps = cmpDescNullsLast(a.operating_hours_per_week, b.operating_hours_per_week);
  if (byOps !== 0) return byOps;
  const byG = cmpDescNullsLast(a.google_rating, b.google_rating);
  if (byG !== 0) return byG;
  const byGC = cmpDescNullsLast(a.google_review_count, b.google_review_count);
  if (byGC !== 0) return byGC;
  return (a.company || '').localeCompare(b.company || '');
}
