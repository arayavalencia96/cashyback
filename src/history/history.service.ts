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

    const rows: string[][] = [
      ['Resumen mensual'],
      ['Mes', this.labelFor(group)],
      ['Sueldo', String(group.salary)],
      ['Total gastos fijos', String(group.fixedExpensesTotal)],
      ['Total variables', String(group.variableExpensesTotal)],
      ['Total inversiones', String(group.investmentsTotal)],
      ['Ocupado', String(group.occupied)],
      ['Restante', String(group.remaining)],
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
    ];

    for (const item of group.items.filter(
      (entry): entry is SummaryHistoryItem & { kind: 'fixed-expense' } =>
        entry.kind === 'fixed-expense',
    )) {
      rows.push([
        item.title,
        String(item.amount),
        item.category,
        item.notes || '',
        item.currency ?? '',
        item.dueDate ? this.formatDisplayDate(item.dueDate) : '',
        item.isPaid ? 'Si' : 'No',
        item.paidAt ? this.formatDisplayDate(item.paidAt) : '',
      ]);
    }

    rows.push(
      [],
      ['Gastos variables'],
      ['Titulo', 'Monto', 'Categoria', 'Notas', 'Moneda', 'Fecha gasto'],
    );

    for (const item of group.items.filter(
      (entry): entry is SummaryHistoryItem & { kind: 'variable-expense' } =>
        entry.kind === 'variable-expense',
    )) {
      rows.push([
        item.title,
        String(item.amount),
        item.category,
        item.notes || '',
        item.currency ?? '',
        this.formatDisplayDate(item.date),
      ]);
    }

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

    for (const item of group.items.filter(
      (entry): entry is SummaryHistoryItem & { kind: 'investment' } =>
        entry.kind === 'investment',
    )) {
      rows.push([
        item.ticker ?? item.title,
        String(item.investmentAmount ?? item.amount),
        item.platform ?? '',
        this.formatDisplayDate(item.transactionDate ?? item.date),
        item.isCompleted ? 'Si' : 'No',
        item.notes || '',
        item.quantity !== undefined ? String(item.quantity) : '',
        item.dollarMepValue !== undefined ? String(item.dollarMepValue) : '',
        item.averagePurchasePrice !== undefined
          ? String(item.averagePurchasePrice)
          : '',
        item.saleDate ? this.formatDisplayDate(item.saleDate) : '',
        item.saleAmount !== undefined ? String(item.saleAmount) : '',
        item.gainLossUsd !== undefined ? String(item.gainLossUsd) : '',
        item.gainLossArs !== undefined ? String(item.gainLossArs) : '',
        item.saleDollarMepValue !== undefined &&
        item.saleDollarMepValue !== null
          ? String(item.saleDollarMepValue)
          : '',
      ]);
    }

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
    const currentMonthStart = new Date();

    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);

    const items: Array<SummaryHistoryItem> = [
      ...fixedExpenses.map((item) => ({
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
      })),
      ...variableExpenses.map((item) => ({
        kind: 'variable-expense' as const,
        id: item.id,
        title: item.data.description,
        amount: item.data.amount,
        category: item.data.category,
        notes: item.data.notes,
        currency: item.data.currency,
        date: item.data.expenseDate,
      })),
      ...investments.map((item) => {
        const transactionDate =
          item.data.transactionDate ?? item.data.purchaseDate ?? '';
        const investedAmount = this.roundMoney(
          (item.data.quantity ?? 0) * (item.data.averagePurchasePrice ?? 0),
        );

        return {
          kind: 'investment' as const,
          id: item.id,
          title: item.data.ticker,
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
            item.data.transactionType === 'venta'
              ? item.data.amount
              : undefined,
          date: transactionDate,
          transactionType: item.data.transactionType,
          transactionDate,
          saleDate: item.data.saleDate ?? null,
          saleDollarMepValue: item.data.saleDollarMepValue ?? null,
          isCompleted: item.data.transactionType === 'venta',
          gainLossArs: item.data.gainLossArs ?? 0,
          gainLossUsd: item.data.gainLossUsd ?? 0,
        };
      }),
    ].filter((item) => item.date && new Date(item.date) < currentMonthStart);

    const groups = new Map<string, HistoryGroup>();

    for (const item of items) {
      const date = new Date(item.date);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      const monthKey = `${date.getFullYear()}-${String(
        date.getMonth() + 1,
      ).padStart(2, '0')}`;
      const salary = this.roundMoney(budgetMap.get(monthKey) ?? 0);
      const currentGroup = groups.get(key);

      if (!currentGroup) {
        const fixedExpensesTotal =
          item.kind === 'fixed-expense' ? item.amount : 0;
        const variableExpensesTotal =
          item.kind === 'variable-expense' ? item.amount : 0;
        const investmentsTotal = item.kind === 'investment' ? item.amount : 0;
        const occupied = this.roundMoney(
          fixedExpensesTotal + variableExpensesTotal + investmentsTotal,
        );

        groups.set(key, {
          month: date.getMonth() + 1,
          year: date.getFullYear(),
          salary,
          fixedExpensesTotal,
          variableExpensesTotal,
          investmentsTotal,
          occupied,
          remaining: this.roundMoney(salary - occupied),
          items: [item],
        });
        continue;
      }

      currentGroup.items.push(item);

      if (item.kind === 'fixed-expense') {
        currentGroup.fixedExpensesTotal = this.roundMoney(
          currentGroup.fixedExpensesTotal + item.amount,
        );
      }

      if (item.kind === 'variable-expense') {
        currentGroup.variableExpensesTotal = this.roundMoney(
          currentGroup.variableExpensesTotal + item.amount,
        );
      }

      if (item.kind === 'investment') {
        currentGroup.investmentsTotal = this.roundMoney(
          currentGroup.investmentsTotal + item.amount,
        );
      }

      currentGroup.occupied = this.roundMoney(
        currentGroup.fixedExpensesTotal +
          currentGroup.variableExpensesTotal +
          currentGroup.investmentsTotal,
      );
      currentGroup.salary = this.roundMoney(
        budgetMap.get(monthKey) ?? currentGroup.salary,
      );
      currentGroup.remaining = this.roundMoney(
        currentGroup.salary - currentGroup.occupied,
      );
    }

    return Array.from(groups.values())
      .sort((left, right) =>
        `${right.year}-${right.month}`.localeCompare(
          `${left.year}-${left.month}`,
        ),
      )
      .map((group) => ({
        ...group,
        items: group.items.sort((left, right) =>
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
    const isoDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);

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
    const text = value.replace(/"/g, '""');
    return `"${text}"`;
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
