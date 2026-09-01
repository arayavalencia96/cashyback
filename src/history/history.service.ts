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

  /**
   * Genera el archivo CSV del historial de un usuario para un mes determinado.
   *
   * @param uid Identificador del usuario propietario del historial.
   * @param year Año del período que se desea exportar.
   * @param month Mes del período, entre 1 y 12.
   * @returns El nombre del archivo y su contenido CSV.
   * @throws BadRequestException Si el año o el mes no son válidos.
   * @throws NotFoundException Si no existe historial para el período solicitado.
   */
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

  /**
   * Construye todas las filas que conforman la exportación CSV de un período.
   *
   * @param group Grupo mensual con sus totales y movimientos.
   * @returns Filas del resumen, gastos e inversiones.
   */
  private buildCsvRows(group: HistoryGroup): string[][] {
    const rows: string[][] = this.buildSummaryRows(group);
    this.addFixedExpensesRows(rows, group);
    this.addVariableExpensesRows(rows, group);
    this.addInvestmentsRows(rows, group);
    return rows;
  }

  /**
   * Construye las filas con los totales generales del período.
   *
   * @param group Grupo mensual que se debe resumir.
   * @returns Filas correspondientes al resumen mensual.
   */
  private buildSummaryRows(group: HistoryGroup): string[][] {
    return [
      ['Resumen mensual'],
      ['Mes', this.labelFor(group)],
      ['Sueldo', String(group.salary)],
      ['Total gastos fijos', String(group.fixedExpensesTotal)],
      ['Objetivo gastos fijos', String(group.fixedExpensesTarget)],
      ['Fijos de más', String(group.fixedExpensesOverspend)],
      ['Total variables', String(group.variableExpensesTotal)],
      ['Objetivo variables', String(group.variableExpensesTarget)],
      ['Variables de más', String(group.variableExpensesOverspend)],
      ['Total inversiones', String(group.investmentsTotal)],
      ['Ocupado', String(group.occupied)],
      [
        group.remaining < 0 ? 'Gastado de más' : 'Restante',
        String(Math.abs(group.remaining)),
      ],
    ];
  }

  /**
   * Agrega al CSV la cabecera y los movimientos de gastos fijos.
   *
   * @param rows Filas acumuladas de la exportación.
   * @param group Grupo mensual que contiene los movimientos.
   */
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

  /**
   * Convierte un gasto fijo en una fila exportable.
   *
   * @param item Gasto fijo normalizado del historial.
   * @returns Valores ordenados según las columnas de gastos fijos.
   */
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

  /**
   * Agrega al CSV la cabecera y los movimientos de gastos variables.
   *
   * @param rows Filas acumuladas de la exportación.
   * @param group Grupo mensual que contiene los movimientos.
   */
  private addVariableExpensesRows(rows: string[][], group: HistoryGroup): void {
    rows.push(
      [],
      ['Gastos variables'],
      [
        'Titulo',
        'Monto',
        'Monto cubierto por promocion',
        'Monto final',
        'Categoria',
        'Notas',
        'Moneda',
        'Fecha gasto',
      ],
    );

    const variableItems = group.items.filter(
      (entry): entry is SummaryHistoryItem & { kind: 'variable-expense' } =>
        entry.kind === 'variable-expense',
    );

    for (const item of variableItems) {
      rows.push(this.buildVariableExpenseRow(item));
    }
  }

  /**
   * Convierte un gasto variable en una fila exportable.
   *
   * @param item Gasto variable normalizado del historial.
   * @returns Valores ordenados según las columnas de gastos variables.
   */
  private buildVariableExpenseRow(
    item: SummaryHistoryItem & { kind: 'variable-expense' },
  ): string[] {
    return [
      item.title,
      String(item.amount),
      String(item.coveredBy ?? 0),
      String(item.finalAmount ?? item.amount),
      item.category,
      item.notes || '',
      item.currency ?? '',
      this.formatDisplayDate(item.date),
    ];
  }

  /**
   * Agrega al CSV la cabecera y los movimientos de inversiones.
   *
   * @param rows Filas acumuladas de la exportación.
   * @param group Grupo mensual que contiene los movimientos.
   */
  private addInvestmentsRows(rows: string[][], group: HistoryGroup): void {
    rows.push(
      [],
      ['Inversiones'],
      [
        'Tipo',
        'Ticker',
        'Monto',
        'Plataforma',
        'Fecha inversion',
        'Fecha acreditacion',
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

  /**
   * Convierte una inversión en una fila exportable.
   *
   * @param item Inversión normalizada del historial.
   * @returns Valores ordenados según las columnas de inversiones.
   */
  private buildInvestmentRow(
    item: SummaryHistoryItem & { kind: 'investment' },
  ): string[] {
    return [
      this.transactionTypeLabel(item.transactionType),
      item.ticker ?? item.title,
      String(this.displayInvestmentAmount(item)),
      item.platform ?? '',
      this.formatDisplayDate(item.transactionDate ?? item.date),
      item.creditedDate ? this.formatDisplayDate(item.creditedDate) : '',
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

  /**
   * Convierte un número opcional a texto para su exportación.
   *
   * @param value Número que se desea serializar.
   * @returns El número como texto o una cadena vacía si no está definido.
   */
  private formatOptionalNumber(value: number | undefined): string {
    return value !== undefined ? String(value) : '';
  }

  private displayInvestmentAmount(
    item: SummaryHistoryItem & { kind: 'investment' },
  ): number {
    const amount = item.investmentAmount ?? item.amount;

    return item.transactionType === 'rendimiento'
      ? this.roundMoney(Math.abs(amount))
      : amount;
  }

  /**
   * Convierte un valor de venta opcional a texto para su exportación.
   *
   * @param value Valor que puede ser numérico, nulo o no estar definido.
   * @returns El valor como texto o una cadena vacía cuando no existe.
   */
  private formatOptionalSaleValue(value: number | null | undefined): string {
    return value !== undefined && value !== null ? String(value) : '';
  }

  private transactionTypeLabel(
    type: SummaryHistoryItem['transactionType'],
  ): string {
    switch (type) {
      case 'venta':
        return 'Venta';
      case 'ahorro':
        return 'Ahorro';
      case 'rendimiento':
        return 'Rendimiento';
      case 'compra':
      default:
        return 'Compra';
    }
  }

  /**
   * Serializa las filas y genera los metadatos del archivo CSV.
   *
   * @param rows Filas que deben incluirse en el archivo.
   * @param year Año del período exportado.
   * @param month Mes del período exportado.
   * @returns Nombre final del archivo y contenido CSV con BOM UTF-8.
   */
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

  /**
   * Obtiene y agrupa el historial anterior al mes actual para un usuario.
   *
   * @param uid Identificador del usuario propietario de los movimientos.
   * @returns Grupos mensuales ordenados desde el período más reciente.
   */
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
      budgets.map((item) => [item.data.monthKey, item.data]),
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

  /**
   * Obtiene el inicio del mes actual en la zona horaria del servidor.
   *
   * @returns Fecha del primer día del mes actual a las 00:00.
   */
  private getCurrentMonthStart(): Date {
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);
    return currentMonthStart;
  }

  /**
   * Normaliza gastos e inversiones y conserva únicamente períodos cerrados.
   *
   * @param fixedExpenses Documentos de gastos fijos del usuario.
   * @param variableExpenses Documentos de gastos variables del usuario.
   * @param investments Documentos de inversiones del usuario.
   * @param currentMonthStart Inicio del mes actual usado como límite.
   * @returns Movimientos normalizados anteriores al mes actual.
   */
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

  /**
   * Convierte un documento de gasto fijo al modelo común del historial.
   *
   * @param item Identificador y datos del documento de Firestore.
   * @returns Movimiento normalizado como gasto fijo.
   */
  private mapFixedExpense(item: {
    id: string;
    data: FixedExpenseRecord;
  }): SummaryHistoryItem {
    return {
      kind: 'fixed-expense' as const,
      id: item.id,
      title: item.data.description,
      amount: item.data.amount,
      budgetAmount:
        item.data.category === 'Comida'
          ? (item.data.spentAmount ?? item.data.amountArs ?? item.data.amount)
          : (item.data.amountArs ?? item.data.amount),
      category: item.data.category,
      notes: item.data.notes,
      currency: item.data.currency,
      date: item.data.dueDate ?? item.data.expenseDate,
      dueDate: item.data.dueDate,
      isPaid: item.data.isPaid,
      paidAt: item.data.paidAt ?? item.data.expenseDate,
    };
  }

  /**
   * Convierte un documento de gasto variable al modelo común del historial.
   *
   * @param item Identificador y datos del documento de Firestore.
   * @returns Movimiento normalizado como gasto variable.
   */
  private mapVariableExpense(item: {
    id: string;
    data: VariableExpenseRecord;
  }): SummaryHistoryItem {
    return {
      kind: 'variable-expense' as const,
      id: item.id,
      title: item.data.description,
      amount: item.data.amount,
      budgetAmount: this.calculateVariableBudgetAmount(item.data),
      category: item.data.category,
      notes: item.data.notes,
      currency: item.data.currency,
      hasPromotion: item.data.hasPromotion ?? (item.data.coveredBy ?? 0) > 0,
      coveredBy: item.data.coveredBy ?? 0,
      finalAmount: this.calculateVariableFinalAmount(item.data),
      date: item.data.expenseDate,
    };
  }

  private calculateVariableFinalAmount(data: VariableExpenseRecord): number {
    const hasPromotion = data.hasPromotion ?? (data.coveredBy ?? 0) > 0;

    return this.roundMoney(
      Math.max(
        0,
        (data.amount ?? 0) - (hasPromotion ? (data.coveredBy ?? 0) : 0),
      ),
    );
  }

  private calculateVariableBudgetAmount(data: VariableExpenseRecord): number {
    if (data.budgetImpact !== undefined && data.budgetImpact !== null) {
      return this.roundMoney(data.budgetImpact);
    }

    const baseAmount = data.amountArs ?? data.amount;

    const hasPromotion = data.hasPromotion ?? (data.coveredBy ?? 0) > 0;

    if (!hasPromotion || (data.coveredBy ?? 0) <= 0) {
      return this.roundMoney(baseAmount);
    }

    const coveredByArs =
      data.currency === 'USD' && data.exchangeRate
        ? this.roundMoney((data.coveredBy ?? 0) * data.exchangeRate)
        : (data.coveredBy ?? 0);

    return this.roundMoney(Math.max(0, baseAmount - coveredByArs));
  }

  /**
   * Convierte un documento de inversión al modelo común del historial.
   *
   * @param item Identificador y datos del documento de Firestore.
   * @returns Movimiento normalizado con datos de compra, venta o ahorro.
   */
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
        item.data.transactionType === 'ahorro'
          ? 'Ahorro'
          : item.data.transactionType === 'rendimiento'
            ? 'Rendimiento'
            : item.data.ticker,
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
      creditedDate: item.data.creditedDate ?? null,
      saleDollarMepValue: item.data.saleDollarMepValue ?? null,
      isCompleted: item.data.transactionType === 'venta',
      gainLossArs: item.data.gainLossArs ?? 0,
      gainLossUsd: item.data.gainLossUsd ?? 0,
    };
  }

  /**
   * Calcula el capital invertido de un movimiento.
   *
   * @param data Datos de la inversión o ahorro.
   * @returns Monto redondeado invertido en el movimiento.
   */
  private calculateInvestedAmount(data: InvestmentRecord): number {
    if (data.transactionType === 'ahorro') {
      return this.roundMoney(data.amount ?? 0);
    }

    if (data.transactionType === 'rendimiento') {
      return this.roundMoney((data.amount ?? 0) * -1);
    }

    return this.roundMoney(
      (data.quantity ?? 0) * (data.averagePurchasePrice ?? 0),
    );
  }

  /**
   * Agrupa los movimientos por año y mes, aplicando el sueldo de cada período.
   *
   * @param items Movimientos normalizados del historial.
   * @param budgetMap Sueldos indexados por clave mensual.
   * @returns Grupos mensuales indexados por período.
   */
  private groupHistoryItems(
    items: Array<SummaryHistoryItem>,
    budgetMap: Map<string, MonthlyBudgetRecord>,
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

  /**
   * Convierte una fecha en la clave mensual utilizada por los presupuestos.
   *
   * @param date Fecha que se debe normalizar.
   * @returns Clave con formato `YYYY-MM`.
   */
  private formatMonthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Crea un grupo mensual a partir de su primer movimiento.
   *
   * @param item Primer movimiento del período.
   * @param date Fecha utilizada para resolver el año y el mes.
   * @param monthKey Clave mensual del presupuesto.
   * @param budgetMap Sueldos indexados por período.
   * @returns Grupo inicial con sus totales calculados.
   */
  private createNewGroup(
    item: SummaryHistoryItem,
    date: Date,
    monthKey: string,
    budgetMap: Map<string, MonthlyBudgetRecord>,
  ): HistoryGroup {
    const totals = this.calculateItemTotals(item);
    const occupied = this.roundMoney(
      totals.fixedExpensesTotal +
        totals.variableExpensesTotal +
        totals.investmentsTotal,
    );
    const budget = budgetMap.get(monthKey);
    const salary = this.roundMoney(budget?.salary ?? 0);
    const fixedExpensesTarget = this.resolveFixedExpensesTarget(budget, salary);
    const variableExpensesTarget = this.resolveVariableExpensesTarget(
      budget,
      salary,
    );

    return {
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      salary,
      fixedExpensesTarget,
      variableExpensesTarget,
      fixedExpensesTotal: totals.fixedExpensesTotal,
      variableExpensesTotal: totals.variableExpensesTotal,
      fixedExpensesOverspend: this.roundMoney(
        Math.max(0, totals.fixedExpensesTotal - fixedExpensesTarget),
      ),
      variableExpensesOverspend: this.roundMoney(
        Math.max(0, totals.variableExpensesTotal - variableExpensesTarget),
      ),
      investmentsTotal: totals.investmentsTotal,
      occupied,
      remaining: this.roundMoney(salary - occupied),
      items: [item],
    };
  }

  /**
   * Distribuye el importe de un movimiento en el total correspondiente.
   *
   * @param item Movimiento cuyo importe se debe clasificar.
   * @returns Totales parciales para gastos fijos, variables e inversiones.
   */
  private calculateItemTotals(item: SummaryHistoryItem): {
    fixedExpensesTotal: number;
    variableExpensesTotal: number;
    investmentsTotal: number;
  } {
    return {
      fixedExpensesTotal:
        item.kind === 'fixed-expense' ? (item.budgetAmount ?? item.amount) : 0,
      variableExpensesTotal:
        item.kind === 'variable-expense'
          ? (item.budgetAmount ?? item.amount)
          : 0,
      investmentsTotal: item.kind === 'investment' ? item.amount : 0,
    };
  }

  /**
   * Incorpora un movimiento a un grupo mensual existente.
   *
   * @param group Grupo mensual que se debe actualizar.
   * @param item Movimiento que se debe incorporar.
   * @param monthKey Clave mensual del presupuesto.
   * @param budgetMap Sueldos indexados por período.
   */
  private updateExistingGroup(
    group: HistoryGroup,
    item: SummaryHistoryItem,
    monthKey: string,
    budgetMap: Map<string, MonthlyBudgetRecord>,
  ): void {
    group.items.push(item);
    this.updateGroupTotals(group, item, monthKey, budgetMap);
  }

  /**
   * Recalcula los totales, el sueldo ocupado y el saldo de un grupo.
   *
   * @param group Grupo mensual que se debe recalcular.
   * @param item Movimiento incorporado al grupo.
   * @param monthKey Clave mensual del presupuesto.
   * @param budgetMap Sueldos indexados por período.
   */
  private updateGroupTotals(
    group: HistoryGroup,
    item: SummaryHistoryItem,
    monthKey: string,
    budgetMap: Map<string, MonthlyBudgetRecord>,
  ): void {
    switch (item.kind) {
      case 'fixed-expense':
        group.fixedExpensesTotal = this.roundMoney(
          group.fixedExpensesTotal + (item.budgetAmount ?? item.amount),
        );
        break;
      case 'variable-expense':
        group.variableExpensesTotal = this.roundMoney(
          group.variableExpensesTotal + (item.budgetAmount ?? item.amount),
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
    const budget = budgetMap.get(monthKey);
    group.salary = this.roundMoney(budget?.salary ?? group.salary);
    group.fixedExpensesTarget = this.resolveFixedExpensesTarget(
      budget,
      group.salary,
    );
    group.variableExpensesTarget = this.resolveVariableExpensesTarget(
      budget,
      group.salary,
    );
    group.fixedExpensesOverspend = this.roundMoney(
      Math.max(0, group.fixedExpensesTotal - group.fixedExpensesTarget),
    );
    group.variableExpensesOverspend = this.roundMoney(
      Math.max(0, group.variableExpensesTotal - group.variableExpensesTarget),
    );
    group.remaining = this.roundMoney(group.salary - group.occupied);
  }

  private resolveFixedExpensesTarget(
    budget: MonthlyBudgetRecord | undefined,
    salary: number,
  ): number {
    return this.roundMoney(
      budget?.fixedExpensesTarget ?? (salary > 0 ? salary * 0.5 : 0),
    );
  }

  private resolveVariableExpensesTarget(
    budget: MonthlyBudgetRecord | undefined,
    salary: number,
  ): number {
    return this.roundMoney(
      budget?.variableExpensesTarget ?? (salary > 0 ? salary * 0.2 : 0),
    );
  }

  /**
   * Ordena los grupos y sus movimientos desde los más recientes.
   *
   * @param groups Grupos mensuales indexados por período.
   * @returns Grupos y movimientos ordenados de forma descendente.
   */
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

  /**
   * Consulta todos los documentos de una colección pertenecientes a un usuario.
   *
   * @param collectionPath Nombre de la colección de Firestore.
   * @param userId Identificador del propietario de los documentos.
   * @returns Documentos encontrados con su identificador y datos tipados.
   */
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

  /**
   * Valida que el año y el mes correspondan a un período admitido.
   *
   * @param year Año que se debe validar.
   * @param month Mes que se debe validar.
   * @throws BadRequestException Si alguno de los valores está fuera de rango.
   */
  private validateMonthAndYear(year: number, month: number): void {
    if (!Number.isInteger(year) || year < 2000 || year > 9999) {
      throw new BadRequestException('El anio solicitado no es valido.');
    }

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('El mes solicitado no es valido.');
    }
  }

  /**
   * Genera una etiqueta localizada para un grupo mensual.
   *
   * @param group Mes y año que se deben representar.
   * @returns Nombre del mes y año en español con mayúscula inicial.
   */
  private labelFor(group: Pick<HistoryGroup, 'month' | 'year'>): string {
    const label = new Intl.DateTimeFormat('es-AR', {
      month: 'long',
      year: 'numeric',
    }).format(new Date(group.year, group.month - 1, 1));

    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  /**
   * Convierte una fecha a un formato legible para el CSV.
   *
   * @param value Fecha ISO, objeto Date o valor opcional.
   * @returns Fecha con formato `DD-MM-YYYY` o `N/A` si no es válida.
   */
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

  /**
   * Escapa un valor para evitar que comillas y separadores alteren el CSV.
   *
   * @param value Texto que se debe incluir en una celda.
   * @returns Valor entre comillas con las comillas internas duplicadas.
   */
  private escapeCsvValue(value: string): string {
    const text = value.replaceAll('"', '""');
    return `"${text}"`;
  }

  /**
   * Redondea un importe monetario a dos decimales.
   *
   * @param value Importe que se debe normalizar.
   * @returns Importe redondeado a dos posiciones decimales.
   */
  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
