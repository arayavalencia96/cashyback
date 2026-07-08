export type CurrencyCode = 'ARS' | 'USD';
export type InvestmentPlatform = 'IOL' | 'BingX' | 'BullMarket' | 'Nexo';

export interface FixedExpenseRecord {
  userId: string;
  description: string;
  expenseDate: string;
  amount: number;
  category: string;
  notes: string;
  currency: CurrencyCode;
  dueDate: string | null;
  isPaid: boolean;
  paidAt: string | null;
}

export interface VariableExpenseRecord {
  userId: string;
  description: string;
  expenseDate: string;
  amount: number;
  category: string;
  notes: string;
  currency: CurrencyCode;
}

export interface InvestmentRecord {
  userId: string;
  ticker: string;
  transactionType: 'compra' | 'venta';
  transactionDate?: string;
  purchaseDate?: string;
  saleDate?: string | null;
  amount: number;
  gainLossArs?: number;
  gainLossUsd?: number;
  platform: InvestmentPlatform;
  averagePurchasePrice: number;
  quantity: number;
  currency: CurrencyCode;
  dollarMepValue?: number;
  saleDollarMepValue?: number | null;
  notes?: string;
}

export interface MonthlyBudgetRecord {
  userId: string;
  monthKey: string;
  salary: number;
}

export interface SummaryHistoryItem {
  kind: 'fixed-expense' | 'variable-expense' | 'investment';
  id: string;
  title: string;
  amount: number;
  category: string;
  notes: string;
  currency?: CurrencyCode;
  platform?: InvestmentPlatform;
  ticker?: string;
  investmentAmount?: number;
  quantity?: number;
  averagePurchasePrice?: number;
  dollarMepValue?: number;
  saleAmount?: number;
  date: string;
  dueDate?: string | null;
  isPaid?: boolean;
  paidAt?: string;
  gainLossArs?: number;
  gainLossUsd?: number;
  transactionType?: 'compra' | 'venta';
  transactionDate?: string;
  saleDate?: string | null;
  saleDollarMepValue?: number | null;
  isCompleted?: boolean;
}

export interface HistoryGroup {
  month: number;
  year: number;
  salary: number;
  fixedExpensesTotal: number;
  variableExpensesTotal: number;
  investmentsTotal: number;
  occupied: number;
  remaining: number;
  items: Array<SummaryHistoryItem>;
}
