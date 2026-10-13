import type { MonthlyAllocation } from './integration.contracts';

export type AllocationState =
  | { status: 'not-configured'; period: string }
  | {
      status: 'available';
      allocation: MonthlyAllocation;
      budgetDefined: boolean;
    };

export type LinkedAllocationState =
  | AllocationState
  | {
      status: 'not-linked' | 'access-paused' | 'disabled';
    };
