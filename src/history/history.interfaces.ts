export type CurrencyCode = 'ARS' | 'USD';
export type InvestmentPlatform = string;
export type InvestmentTransactionType =
  'compra' | 'venta' | 'ahorro' | 'rendimiento';

export interface FixedExpenseRecord {
  userId: string;
  description: string;
  expenseDate: string;
  amount: number;
  amountArs?: number | null;
  spentAmount?: number;
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
  amountArs?: number | null;
  exchangeRate?: number | null;
  category: string;
  notes: string;
  currency: CurrencyCode;
  hasPromotion?: boolean;
  coveredBy?: number;
  budgetImpact?: number | null;
}

export interface InvestmentRecord {
  userId: string;
  ticker: string;
  transactionType: InvestmentTransactionType;
  transactionDate?: string;
  purchaseDate?: string;
  saleDate?: string | null;
  creditedDate?: string | null;
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
  fixedExpensesTarget?: number | null;
  variableExpensesTarget?: number | null;
  isVariableExpensesModified?: boolean;
}

export interface SummaryHistoryItem {
  kind: 'fixed-expense' | 'variable-expense' | 'investment';
  id: string;
  title: string;
  amount: number;
  budgetAmount?: number;
  targetAmount?: number;
  category: string;
  notes: string;
  currency?: CurrencyCode;
  hasPromotion?: boolean;
  coveredBy?: number;
  finalAmount?: number;
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
  transactionType?: InvestmentTransactionType;
  transactionDate?: string;
  saleDate?: string | null;
  creditedDate?: string | null;
  saleDollarMepValue?: number | null;
  isCompleted?: boolean;
}

export interface HistoryGroup {
  month: number;
  year: number;
  salary: number;
  fixedExpensesTarget: number;
  fixedExpensesBaseTotal: number;
  variableExpensesTarget: number;
  savingsInvestmentTarget: number;
  fixedExpensesTotal: number;
  variableExpensesTotal: number;
  fixedExpensesOverspend: number;
  variableExpensesOverspend: number;
  investmentsTotal: number;
  occupied: number;
  remaining: number;
  items: Array<SummaryHistoryItem>;
}
