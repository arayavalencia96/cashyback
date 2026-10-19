import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  allocationPeriod,
  assignedFromBudget,
  moneyMinor,
  requireAllocationPeriod,
} from './allocation-budget';

describe('allocation budget', () => {
  it('uses the Buenos Aires month at UTC boundaries', () => {
    expect(allocationPeriod(new Date('2026-10-01T02:30:00.000Z'))).toBe(
      '2026-09',
    );
  });

  it('calculates the savings allocation from salary targets', () => {
    expect(
      assignedFromBudget(
        {
          salary: 1_000_000,
          fixedExpensesTarget: 500_000,
          variableExpensesTarget: 200_000,
        },
        [],
        '2026-09',
      ),
    ).toBe(30_000_000);
  });

  it('recalculates allocation from actual fixed expenses', () => {
    expect(
      assignedFromBudget(
        { salary: 1_000_000, isVariableExpensesModified: false },
        [{ expenseDate: '2026-09-10', amountArs: 400_000 }],
        '2026-09',
      ),
    ).toBe(36_000_000);
  });

  it('rejects future periods and invalid monetary values', () => {
    expect(() => requireAllocationPeriod('2099-01')).toThrow(
      BadRequestException,
    );
    expect(() => moneyMinor(Number.NaN)).toThrow(ServiceUnavailableException);
  });
});
