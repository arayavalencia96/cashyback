import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { FirebaseAdminService } from 'src/common/services/firebase.service';

import type {
  FixedExpenseRecord,
  HistoryGroup,
  InvestmentRecord,
  MonthlyBudgetRecord,
  SummaryHistoryItem,
  VariableExpenseRecord,
} from './history.interfaces';

@Injectable()
export class HistoryService {
  private readonly fixedExpensesCollection = 'fixedExpenses';
  private readonly variableExpensesCollection = 'variableExpenses';
  private readonly investmentsCollection = 'investments';
  private readonly monthlyBudgetsCollection = 'monthlyBudgets';

  constructor(private readonly firebaseAdminService: FirebaseAdminService) {}

  async exportGroupCsv(
    uid: string,
    year: number,
    month: number,
  ): Promise<{ fileName: string; content: string }> {
    this.validateMonthAndYear(year, month);

    const groups = await this.listHistoryGroups(uid);
    const group = groups.find(
      (entry) => entry.year === year && entry.month === month,
    );

    if (!group) {
      throw new NotFoundException(
        'No existe historial exportable para el mes solicitado.',
      );
    }

    const rows = this.buildCsvRows(group);
    return this.formatCsvOutput(rows, year, month);
  }

  private buildCsvRows(group: HistoryGroup): string[][] {
    const rows: string[][] = this.buildSummaryRows(group);
    this.addFixedExpensesRows(rows, group);
    this.addVariableExpensesRows(rows, group);
    this.addInvestmentsRows(rows, group);
    return rows;
  }

  private buildSummaryRows(group: HistoryGroup): string[][] {
    return [
      ['Resumen mensual'],
      ['Mes', this.labelFor(group)],
      ['Sueldo', String(group.salary)],
      ['Total gastos fijos', String(group.fixedExpensesTotal)],
      ['Total variables', String(group.variableExpensesTotal)],
      ['Total inversiones', String(group.investmentsTotal)],
      ['Ocupado', String(group.occupied)],
      ['Restante', String(group.remaining)],
    ];
  }

  private addFixedExpensesRows(rows: string[][], group: HistoryGroup): void {
    rows.push(
      [],
      ['Gastos fijos'],
      [
        'Titulo',
        'Monto',
        'Categoria',
        'Notas',
        'Moneda',
        'Fecha vencimiento',
        'Pagado',
        'Fecha pago',
      ],
    );

    const fixedItems = group.items.filter(
      (entry): entry is SummaryHistoryItem & { kind: 'fixed-expense' } =>
        entry.kind === 'fixed-expense',
    );

    for (const item of fixedItems) {
      rows.push(this.buildFixedExpenseRow(item));
    }
  }

  private buildFixedExpenseRow(
    item: SummaryHistoryItem & { kind: 'fixed-expense' },
  ): string[] {
    return [
      item.title,
      String(item.amount),
      item.category,
      item.notes || '',
      item.currency ?? '',
      item.dueDate ? this.formatDisplayDate(item.dueDate) : '',
      item.isPaid ? 'Si' : 'No',
      item.paidAt ? this.formatDisplayDate(item.paidAt) : '',
    ];
  }

  private addVariableExpensesRows(rows: string[][], group: HistoryGroup): void {
    rows.push(
      [],
      ['Gastos variables'],
      ['Titulo', 'Monto', 'Categoria', 'Notas', 'Moneda', 'Fecha gasto'],
    );

    const variableItems = group.items.filter(
      (entry): entry is SummaryHistoryItem & { kind: 'variable-expense' } =>
        entry.kind === 'variable-expense',
    );

    for (const item of variableItems) {
      rows.push(this.buildVariableExpenseRow(item));
    }
  }

  private buildVariableExpenseRow(
    item: SummaryHistoryItem & { kind: 'variable-expense' },
  ): string[] {
    return [
      item.title,
      String(item.amount),
      item.category,
      item.notes || '',
      item.currency ?? '',
      this.formatDisplayDate(item.date),
    ];
  }

  private addInvestmentsRows(rows: string[][], group: HistoryGroup): void {
    rows.push(
      [],
      ['Inversiones'],
      [
        'Ticker',
        'Monto invertido',
        'Plataforma',
        'Fecha inversion',
        'Finalizada',
        'Notas',
        'Cantidad',
        'Valor dolar MEP',
        'Precio promedio compra',
        'Fecha venta',
        'Monto obtenido por la venta',
        'Ganancia USD',
        'Ganancia ARS',
        'Valor MEP venta',
      ],
    );

    const investmentItems = group.items.filter(
      (entry): entry is SummaryHistoryItem & { kind: 'investment' } =>
        entry.kind === 'investment',
    );

    for (const item of investmentItems) {
      rows.push(this.buildInvestmentRow(item));
    }
  }

  private buildInvestmentRow(
    item: SummaryHistoryItem & { kind: 'investment' },
  ): string[] {
    return [
      item.ticker ?? item.title,
      String(item.investmentAmount ?? item.amount),
      item.platform ?? '',
      this.formatDisplayDate(item.transactionDate ?? item.date),
      item.isCompleted ? 'Si' : 'No',
      item.notes || '',
      this.formatOptionalNumber(item.quantity),
      this.formatOptionalNumber(item.dollarMepValue),
      this.formatOptionalNumber(item.averagePurchasePrice),
      item.saleDate ? this.formatDisplayDate(item.saleDate) : '',
      this.formatOptionalNumber(item.saleAmount),
      this.formatOptionalNumber(item.gainLossUsd),
      this.formatOptionalNumber(item.gainLossArs),
      this.formatOptionalSaleValue(item.saleDollarMepValue),
    ];
  }

  private formatOptionalNumber(value: number | undefined): string {
    return value !== undefined ? String(value) : '';
  }

  private formatOptionalSaleValue(value: number | null | undefined): string {
    return value !== undefined && value !== null ? String(value) : '';
  }

  private formatCsvOutput(
    rows: string[][],
    year: number,
    month: number,
  ): { fileName: string; content: string } {
    return {
      fileName: `cashy-historial-${year}-${String(month).padStart(2, '0')}.csv`,
      content: `\ufeff${rows
        .map((row) => row.map((value) => this.escapeCsvValue(value)).join(';'))
        .join('\n')}`,
    };
  }

  private async listHistoryGroups(uid: string): Promise<Array<HistoryGroup>> {
    const [fixedExpenses, variableExpenses, investments, budgets] =
      await Promise.all([
        this.findAllByUserId<FixedExpenseRecord>(
          this.fixedExpensesCollection,
          uid,
        ),
        this.findAllByUserId<VariableExpenseRecord>(
          this.variableExpensesCollection,
          uid,
        ),
        this.findAllByUserId<InvestmentRecord>(this.investmentsCollection, uid),
        this.findAllByUserId<MonthlyBudgetRecord>(
          this.monthlyBudgetsCollection,
          uid,
        ),
      ]);

    const budgetMap = new Map(
      budgets.map((item) => [item.data.monthKey, item.data.salary]),
    );
    const currentMonthStart = this.getCurrentMonthStart();

    const items = this.buildHistoryItems(
      fixedExpenses,
      variableExpenses,
      investments,
      currentMonthStart,
    );
    const groups = this.groupHistoryItems(items, budgetMap);

    return this.sortAndFormatGroups(groups);
  }

  private getCurrentMonthStart(): Date {
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);
    return currentMonthStart;
  }

  private buildHistoryItems(
    fixedExpenses: Array<{ id: string; data: FixedExpenseRecord }>,
    variableExpenses: Array<{ id: string; data: VariableExpenseRecord }>,
    investments: Array<{ id: string; data: InvestmentRecord }>,
    currentMonthStart: Date,
  ): Array<SummaryHistoryItem> {
    const items: Array<SummaryHistoryItem> = [
      ...fixedExpenses.map((item) => this.mapFixedExpense(item)),
      ...variableExpenses.map((item) => this.mapVariableExpense(item)),
      ...investments.map((item) => this.mapInvestment(item)),
    ];
    return items.filter(
      (item) => item.date && new Date(item.date) < currentMonthStart,
    );
  }

  private mapFixedExpense(item: {
    id: string;
    data: FixedExpenseRecord;
  }): SummaryHistoryItem {
    return {
      kind: 'fixed-expense' as const,
      id: item.id,
      title: item.data.description,
      amount: item.data.amount,
      category: item.data.category,
      notes: item.data.notes,
      currency: item.data.currency,
      date: item.data.dueDate ?? item.data.expenseDate,
      dueDate: item.data.dueDate,
      isPaid: item.data.isPaid,
      paidAt: item.data.paidAt ?? item.data.expenseDate,
    };
  }

  private mapVariableExpense(item: {
    id: string;
    data: VariableExpenseRecord;
  }): SummaryHistoryItem {
    return {
      kind: 'variable-expense' as const,
      id: item.id,
      title: item.data.description,
      amount: item.data.amount,
      category: item.data.category,
      notes: item.data.notes,
      currency: item.data.currency,
      date: item.data.expenseDate,
    };
  }

  private mapInvestment(item: {
    id: string;
    data: InvestmentRecord;
  }): SummaryHistoryItem {
    const transactionDate =
      item.data.transactionDate ?? item.data.purchaseDate ?? '';
    const investedAmount = this.calculateInvestedAmount(item.data);

    return {
      kind: 'investment' as const,
      id: item.id,
      title:
        item.data.transactionType === 'ahorro' ? 'Ahorro' : item.data.ticker,
      amount: investedAmount,
      category: item.data.platform,
      notes: item.data.notes ?? '',
      currency: item.data.currency,
      ticker: item.data.ticker,
      platform: item.data.platform,
      investmentAmount: investedAmount,
      quantity: item.data.quantity,
      averagePurchasePrice: item.data.averagePurchasePrice,
      dollarMepValue: item.data.dollarMepValue,
      saleAmount:
        item.data.transactionType === 'venta' ? item.data.amount : undefined,
      date: transactionDate,
      transactionType: item.data.transactionType,
      transactionDate,
      saleDate: item.data.saleDate ?? null,
      saleDollarMepValue: item.data.saleDollarMepValue ?? null,
      isCompleted: item.data.transactionType === 'venta',
      gainLossArs: item.data.gainLossArs ?? 0,
      gainLossUsd: item.data.gainLossUsd ?? 0,
    };
  }

  private calculateInvestedAmount(data: InvestmentRecord): number {
    return data.transactionType === 'ahorro'
      ? this.roundMoney(data.amount ?? 0)
      : this.roundMoney(
          (data.quantity ?? 0) * (data.averagePurchasePrice ?? 0),
        );
  }

  private groupHistoryItems(
    items: Array<SummaryHistoryItem>,
    budgetMap: Map<string, number>,
  ): Map<string, HistoryGroup> {
    const groups = new Map<string, HistoryGroup>();

    for (const item of items) {
      const date = new Date(item.date);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      const monthKey = this.formatMonthKey(date);
      const currentGroup = groups.get(key);

      if (!currentGroup) {
        groups.set(key, this.createNewGroup(item, date, monthKey, budgetMap));
      } else {
        this.updateExistingGroup(currentGroup, item, monthKey, budgetMap);
      }
    }

    return groups;
  }

  private formatMonthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private createNewGroup(
    item: SummaryHistoryItem,
    date: Date,
    monthKey: string,
    budgetMap: Map<string, number>,
  ): HistoryGroup {
    const totals = this.calculateItemTotals(item);
    const occupied = this.roundMoney(
      totals.fixedExpensesTotal +
        totals.variableExpensesTotal +
        totals.investmentsTotal,
    );
    const salary = this.roundMoney(budgetMap.get(monthKey) ?? 0);

    return {
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      salary,
      fixedExpensesTotal: totals.fixedExpensesTotal,
      variableExpensesTotal: totals.variableExpensesTotal,
      investmentsTotal: totals.investmentsTotal,
      occupied,
      remaining: this.roundMoney(salary - occupied),
      items: [item],
    };
  }

  private calculateItemTotals(item: SummaryHistoryItem): {
    fixedExpensesTotal: number;
    variableExpensesTotal: number;
    investmentsTotal: number;
  } {
    return {
      fixedExpensesTotal: item.kind === 'fixed-expense' ? item.amount : 0,
      variableExpensesTotal: item.kind === 'variable-expense' ? item.amount : 0,
      investmentsTotal: item.kind === 'investment' ? item.amount : 0,
    };
  }

  private updateExistingGroup(
    group: HistoryGroup,
    item: SummaryHistoryItem,
    monthKey: string,
    budgetMap: Map<string, number>,
  ): void {
    group.items.push(item);
    this.updateGroupTotals(group, item, monthKey, budgetMap);
  }

  private updateGroupTotals(
    group: HistoryGroup,
    item: SummaryHistoryItem,
    monthKey: string,
    budgetMap: Map<string, number>,
  ): void {
    switch (item.kind) {
      case 'fixed-expense':
        group.fixedExpensesTotal = this.roundMoney(
          group.fixedExpensesTotal + item.amount,
        );
        break;
      case 'variable-expense':
        group.variableExpensesTotal = this.roundMoney(
          group.variableExpensesTotal + item.amount,
        );
        break;
      case 'investment':
        group.investmentsTotal = this.roundMoney(
          group.investmentsTotal + item.amount,
        );
        break;
    }

    group.occupied = this.roundMoney(
      group.fixedExpensesTotal +
        group.variableExpensesTotal +
        group.investmentsTotal,
    );
    group.salary = this.roundMoney(budgetMap.get(monthKey) ?? group.salary);
    group.remaining = this.roundMoney(group.salary - group.occupied);
  }

  private sortAndFormatGroups(
    groups: Map<string, HistoryGroup>,
  ): Array<HistoryGroup> {
    return Array.from(groups.values())
      .sort((left, right) =>
        `${right.year}-${right.month}`.localeCompare(
          `${left.year}-${left.month}`,
        ),
      )
      .map((group) => ({
        ...group,
        items: group.items.toSorted((left, right) =>
          right.date.localeCompare(left.date),
        ),
      }));
  }

  private async findAllByUserId<T extends { userId: string }>(
    collectionPath: string,
    userId: string,
  ): Promise<Array<{ id: string; data: T }>> {
    const snapshot = await this.firebaseAdminService.firestore
      .collection(collectionPath)
      .where('userId', '==', userId)
      .get();

    return snapshot.docs.map((document) => ({
      id: document.id,
      data: document.data() as T,
    }));
  }

  private validateMonthAndYear(year: number, month: number): void {
    if (!Number.isInteger(year) || year < 2000 || year > 9999) {
      throw new BadRequestException('El anio solicitado no es valido.');
    }

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('El mes solicitado no es valido.');
    }
  }

  private labelFor(group: Pick<HistoryGroup, 'month' | 'year'>): string {
    const label = new Intl.DateTimeFormat('es-AR', {
      month: 'long',
      year: 'numeric',
    }).format(new Date(group.year, group.month - 1, 1));

    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  private formatDisplayDate(value: string | Date | null | undefined): string {
    if (!value) {
      return 'N/A';
    }

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        return 'N/A';
      }

      const day = String(value.getDate()).padStart(2, '0');
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const year = value.getFullYear();

      return `${day}-${month}-${year}`;
    }

    const normalized = value.trim();
    const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(normalized);

    if (isoDateMatch) {
      const [, year, month, day] = isoDateMatch;
      return `${day}-${month}-${year}`;
    }

    const parsed = new Date(normalized);

    if (!Number.isNaN(parsed.getTime())) {
      const day = String(parsed.getDate()).padStart(2, '0');
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      const year = parsed.getFullYear();

      return `${day}-${month}-${year}`;
    }

    return 'N/A';
  }

  private escapeCsvValue(value: string): string {
    const text = value.replaceAll('"', '""');
    return `"${text}"`;
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
