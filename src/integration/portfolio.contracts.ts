export interface PortfolioSummary {
  totalBookValue: { ars: number; usd: number };
  platformBookValues: {
    platform: string;
    value: { ars: number; usd: number };
  }[];
  goalsCount: number;
  hasUnconvertedAmounts: boolean;
}
export function isPortfolioSummary(value: unknown): value is PortfolioSummary {
  const money = (v: unknown): boolean =>
    !!v &&
    typeof v === 'object' &&
    ['ars', 'usd'].every(
      (key) =>
        typeof (v as Record<string, unknown>)[key] === 'number' &&
        Number.isFinite((v as Record<string, number>)[key]),
    );
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    money(row.totalBookValue) &&
    Number.isSafeInteger(row.goalsCount) &&
    (row.goalsCount as number) >= 0 &&
    typeof row.hasUnconvertedAmounts === 'boolean' &&
    Array.isArray(row.platformBookValues) &&
    row.platformBookValues.every(
      (v) =>
        !!v &&
        typeof v === 'object' &&
        typeof (v as Record<string, unknown>).platform === 'string' &&
        money((v as Record<string, unknown>).value),
    )
  );
}
