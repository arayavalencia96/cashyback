jest.mock('src/common/services/firebase.service', () => ({
  FirebaseAdminService: class FirebaseAdminService {},
}));

import ExcelJS from 'exceljs';
import type { FirebaseAdminService } from 'src/common/services/firebase.service';

import { HistoryService } from './history.service';

const loadWorkbook = async (content: Buffer): Promise<ExcelJS.Workbook> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content);
  return workbook;
};

describe('HistoryService', () => {
  const createService = (
    documents: Record<string, Array<{ id: string; data: () => object }>>,
  ): HistoryService => {
    const collection = jest.fn((path: string) => ({
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: documents[path] ?? [] }),
    }));

    return new HistoryService({
      firestore: { collection },
    } as unknown as FirebaseAdminService);
  };

  it('exports a closed month with its summary and movements', async () => {
    const documents = {
      fixedExpenses: [
        {
          id: 'fixed-1',
          data: () => ({
            userId: 'uid-1',
            description: 'Alquiler',
            expenseDate: '2025-06-01',
            amount: 300,
            category: 'Vivienda',
            notes: '',
            currency: 'ARS',
            dueDate: '2025-06-10',
            isPaid: true,
            paidAt: '2025-06-09',
          }),
        },
      ],
      variableExpenses: [
        {
          id: 'variable-1',
          data: () => ({
            userId: 'uid-1',
            description: 'Supermercado',
            expenseDate: '2025-06-12',
            amount: 100,
            category: 'Comida',
            notes: '',
            currency: 'ARS',
          }),
        },
      ],
      investments: [
        {
          id: 'investment-1',
          data: () => ({
            userId: 'uid-1',
            ticker: 'SPY',
            transactionType: 'compra',
            transactionDate: '2025-06-15',
            amount: 200,
            platform: 'IOL',
            averagePurchasePrice: 100,
            quantity: 2,
            currency: 'USD',
          }),
        },
      ],
      monthlyBudgets: [
        {
          id: 'budget-1',
          data: () => ({
            userId: 'uid-1',
            monthKey: '2025-06',
            salary: 1000,
          }),
        },
      ],
    };
    const collection = jest.fn((path: keyof typeof documents) => {
      const query = {
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: documents[path] }),
      };
      return query;
    });
    const firebaseAdminService = {
      firestore: { collection },
    } as unknown as FirebaseAdminService;
    const service = new HistoryService(firebaseAdminService);

    const file = await service.exportGroupXlsx('uid-1', 2025, 6);
    const workbook = await loadWorkbook(file.content);

    expect(file.fileName).toBe('cashy-historial-2025-06.xlsx');
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      'Resumen',
      'Gastos fijos',
      'Gastos variables',
      'Ahorro e inversiones',
    ]);
    expect(workbook.getWorksheet('Resumen')?.getCell('A1').value).toContain(
      'Junio',
    );
    expect(
      workbook.getWorksheet('Resumen')?.getCell('A1').alignment,
    ).toMatchObject({
      horizontal: 'center',
    });
    expect(
      workbook.getWorksheet('Gastos fijos')?.getCell('A4').alignment,
    ).toMatchObject({ horizontal: 'center' });
    expect(workbook.getWorksheet('Gastos fijos')?.getCell('A4').value).toBe(
      'Alquiler',
    );
    expect(workbook.getWorksheet('Gastos variables')?.getCell('B4').value).toBe(
      'Supermercado',
    );
    expect(
      workbook.getWorksheet('Ahorro e inversiones')?.getCell('C4').value,
    ).toBe('SPY');
    expect(collection).toHaveBeenCalledTimes(4);
  });

  it.each([
    [1999, 6],
    [10_000, 6],
    [2025.5, 6],
    [2025, 0],
    [2025, 13],
    [2025, 1.5],
  ])('rejects invalid periods', async (year, month) => {
    const service = createService({});

    await expect(service.exportGroupXlsx('uid-1', year, month)).rejects.toThrow(
      'no es valido',
    );
  });

  it('rejects a valid month without historical movements', async () => {
    const service = createService({});

    await expect(service.exportGroupXlsx('uid-1', 2025, 6)).rejects.toThrow(
      'No existe historial exportable',
    );
  });

  it('supports optional values, savings and completed sales', async () => {
    const service = createService({
      fixedExpenses: [
        {
          id: 'fixed-optional',
          data: () => ({
            userId: 'uid-1',
            description: 'Seguro "auto"',
            expenseDate: '2025-06-02',
            amount: 50.555,
            category: 'Auto',
            isPaid: false,
          }),
        },
      ],
      variableExpenses: [
        {
          id: 'future',
          data: () => ({
            userId: 'uid-1',
            description: 'Futuro',
            expenseDate: '2999-01-01',
            amount: 10,
            category: 'Otro',
          }),
        },
      ],
      investments: [
        {
          id: 'saving',
          data: () => ({
            userId: 'uid-1',
            ticker: 'USD',
            transactionType: 'ahorro',
            purchaseDate: '2025-06-03',
            amount: 100.125,
            platform: 'Banco',
          }),
        },
        {
          id: 'sale',
          data: () => ({
            userId: 'uid-1',
            ticker: 'SPY',
            transactionType: 'venta',
            transactionDate: '2025-06-04',
            amount: 250,
            platform: 'Broker',
            quantity: 2,
            averagePurchasePrice: 100,
            saleDate: '2025-06-05',
            saleDollarMepValue: 1200,
            gainLossArs: 50,
            gainLossUsd: 5,
          }),
        },
        {
          id: 'yield',
          data: () => ({
            userId: 'uid-1',
            ticker: 'Rendimiento',
            transactionType: 'rendimiento',
            transactionDate: '2025-06-30',
            creditedDate: '2025-07-01',
            amount: 1000.5,
            platform: 'Mercado Pago',
            averagePurchasePrice: 0,
            quantity: 0,
            currency: 'ARS',
          }),
        },
      ],
      monthlyBudgets: [],
    });

    const file = await service.exportGroupXlsx('uid-1', 2025, 6);
    const workbook = await loadWorkbook(file.content);
    const fixedExpenses = workbook.getWorksheet('Gastos fijos');
    const investments = workbook.getWorksheet('Ahorro e inversiones');
    const savingsRow = investments
      ?.getRows(4, investments.rowCount - 3)
      .find((row) => row.getCell(2).value === 'Ahorro');
    const yieldRow = investments
      ?.getRows(4, investments.rowCount - 3)
      .find((row) => row.getCell(2).value === 'Rendimiento');

    expect(fixedExpenses?.getCell('A4').value).toBe('Seguro "auto"');
    expect(fixedExpenses?.getCell('G4').value).toBe('Pendiente');
    expect(savingsRow?.getCell(6).value).toBe('Banco');
    expect(yieldRow?.getCell(6).value).toBe('Mercado Pago');
  });

  it('exports recalculated targets when fixed food overspends and variables are manually assigned', async () => {
    const service = createService({
      fixedExpenses: [
        {
          id: 'fixed-services',
          data: () => ({
            userId: 'uid-1',
            description: 'Servicios',
            expenseDate: '2026-08-01',
            amount: 858_891.01,
            amountArs: 858_891.01,
            category: 'Servicios',
            notes: '',
            currency: 'ARS',
            dueDate: '2026-08-10',
            isPaid: true,
            paidAt: '2026-08-10',
          }),
        },
        {
          id: 'fixed-food',
          data: () => ({
            userId: 'uid-1',
            description: 'Comida puntual',
            expenseDate: '2026-08-01',
            amount: 300_000,
            amountArs: 300_000,
            spentAmount: 355_107.28,
            category: 'Comida',
            notes: '',
            currency: 'ARS',
            dueDate: '2026-08-10',
            isPaid: true,
            paidAt: '2026-08-10',
          }),
        },
      ],
      variableExpenses: [
        {
          id: 'variable-overspent',
          data: () => ({
            userId: 'uid-1',
            description: 'Variables agosto',
            expenseDate: '2026-08-31',
            amount: 680_728.07,
            amountArs: 680_728.07,
            budgetImpact: 680_728.07,
            category: 'Supermercado',
            notes: '',
            currency: 'ARS',
          }),
        },
      ],
      investments: [
        {
          id: 'investment-savings',
          data: () => ({
            userId: 'uid-1',
            ticker: 'ARS',
            transactionType: 'ahorro',
            transactionDate: '2026-08-15',
            amount: 600_000,
            platform: 'Mercado Pago',
            averagePurchasePrice: 0,
            quantity: 0,
            currency: 'ARS',
          }),
        },
        {
          id: 'investment-yield',
          data: () => ({
            userId: 'uid-1',
            ticker: 'Rendimiento',
            transactionType: 'rendimiento',
            transactionDate: '2026-08-31',
            amount: 13_833.54,
            platform: 'Mercado Pago',
            averagePurchasePrice: 0,
            quantity: 0,
            currency: 'ARS',
          }),
        },
      ],
      monthlyBudgets: [
        {
          id: 'budget-august',
          data: () => ({
            userId: 'uid-1',
            monthKey: '2026-08',
            salary: 2_379_176,
            fixedExpensesTarget: 1_189_588,
            variableExpensesTarget: 620_000,
            isVariableExpensesModified: true,
          }),
        },
      ],
    });

    const file = await service.exportGroupXlsx('uid-1', 2026, 8);
    const workbook = await loadWorkbook(file.content);
    const summary = workbook.getWorksheet('Resumen');

    expect(summary?.getCell('B6').value).toBe(1_158_891.01);
    expect(summary?.getCell('C6').value).toBe(1_213_998.29);
    expect(summary?.getCell('B7').value).toBe(620_000);
    expect(summary?.getCell('C7').value).toBe(680_728.07);
    expect(summary?.getCell('B8').value).toBe(600_284.99);
    expect(summary?.getCell('C8').value).toBe(600_000);
    expect(summary?.getCell('C9').value).toBe(13_833.54);
    expect(summary?.getCell('B11').value).toBe(284.99);
    expect(summary?.getCell('B13').value).toBe(2_480_892.82);
    expect(summary?.getCell('B13').numFmt).toContain('$');
    expect(summary?.getCell('D6').value).toMatchObject({
      formula: 'C6-B6',
      result: 55_107.28,
    });
    expect(summary?.getCell('D7').value).toMatchObject({
      formula: 'C7-B7',
      result: 60_728.07,
    });
    expect(summary?.getCell('D8').value).toMatchObject({
      formula: 'C8-B8',
      result: -284.99,
    });
    expect(summary?.getCell('D9').value).toMatchObject({
      formula: '-C9',
      result: -13_833.54,
    });
    expect(summary?.getCell('B14').value).toMatchObject({
      formula: 'ABS(SUM(D6:D9))',
      result: 101_716.82,
    });
  });

  it('formats every supported date representation', () => {
    const service = createService({});
    const internal = service as unknown as {
      formatDisplayDate: (value: string | Date | null | undefined) => string;
    };

    expect(internal.formatDisplayDate(undefined)).toBe('N/A');
    expect(internal.formatDisplayDate(new Date('invalid'))).toBe('N/A');
    expect(internal.formatDisplayDate(new Date(2025, 5, 3))).toBe('03-06-2025');
    expect(internal.formatDisplayDate('2025-06-04T10:00:00')).toBe(
      '04-06-2025',
    );
    expect(internal.formatDisplayDate('June 5, 2025')).toBe('05-06-2025');
    expect(internal.formatDisplayDate('not-a-date')).toBe('N/A');
  });
});
