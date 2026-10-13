import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';

export const allocationTimezone = 'America/Buenos_Aires';

export function allocationPeriod(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: allocationTimezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  return (
    parts.find((part) => part.type === 'year')!.value +
    '-' +
    parts.find((part) => part.type === 'month')!.value
  );
}

export function requireAllocationPeriod(value: unknown): string {
  if (value === undefined) return allocationPeriod();
  if (
    typeof value !== 'string' ||
    !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(value) ||
    value > allocationPeriod()
  ) {
    throw new BadRequestException(
      'El período debe ser YYYY-MM y no puede ser futuro.',
    );
  }
  return value;
}

export function moneyMinor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new ServiceUnavailableException(
      'El presupuesto contiene un importe inválido.',
    );
  const minor = Math.round((value + Number.EPSILON) * 100);
  return safeMinor(minor);
}

export function safeMinor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new ServiceUnavailableException(
      'El importe excede la precisión admitida.',
    );
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ServiceUnavailableException(
      'El presupuesto contiene datos inválidos.',
    );
  return value as Record<string, unknown>;
}

export function assignedFromBudget(
  budget: Record<string, unknown>,
  expenses: Record<string, unknown>[],
  period: string,
): number {
  if (budget.isSalaryDefined === false) return 0;
  const components = budget.salaryComponents ?? [];
  if (!Array.isArray(components))
    throw new ServiceUnavailableException(
      'Los ingresos del presupuesto son inválidos.',
    );
  const items: unknown[] = components;
  const componentMinor = safeMinor(
    items.reduce<number>((total, item) => {
      const amount = record(item).amount;
      return total + moneyMinor(amount);
    }, 0),
  );
  const salary = componentMinor || moneyMinor(budget.salary ?? 0);
  const fixedTarget =
    budget.fixedExpensesTarget == null
      ? Math.round(salary * 0.5)
      : moneyMinor(budget.fixedExpensesTarget);
  const variableTarget =
    budget.variableExpensesTarget == null
      ? Math.round(salary * 0.2)
      : moneyMinor(budget.variableExpensesTarget);
  let fixedPesos = 0;
  for (const expense of expenses) {
    if (
      typeof expense.expenseDate !== 'string' ||
      !Number.isFinite(Date.parse(expense.expenseDate))
    )
      throw new ServiceUnavailableException(
        'Un gasto fijo contiene una fecha inválida.',
      );
    if (allocationPeriod(new Date(expense.expenseDate)) !== period) continue;
    const amount = expense.amountArs ?? expense.amount;
    moneyMinor(amount);
    fixedPesos += amount as number;
  }
  const fixed = moneyMinor(fixedPesos);
  if (fixed === 0) return Math.max(0, salary - fixedTarget - variableTarget);
  const remaining = Math.max(0, salary - fixed);
  const variable = budget.isVariableExpensesModified
    ? Math.min(variableTarget, remaining)
    : Math.round(remaining * 0.4);
  return safeMinor(Math.max(0, remaining - variable));
}
