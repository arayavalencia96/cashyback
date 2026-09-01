jest.mock('src/common/services/firebase.service', () => ({
  FirebaseAdminService: class FirebaseAdminService {},
}));

import type { FirebaseAdminService } from 'src/common/services/firebase.service';

import { HistoryService } from './history.service';

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

    const file = await service.exportGroupCsv('uid-1', 2025, 6);

    expect(file.fileName).toBe('cashy-historial-2025-06.csv');
    expect(file.content).toContain('Resumen mensual');
    expect(file.content).toContain('Alquiler');
    expect(file.content).toContain('Supermercado');
    expect(file.content).toContain('SPY');
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

    await expect(service.exportGroupCsv('uid-1', year, month)).rejects.toThrow(
      'no es valido',
    );
  });

  it('rejects a valid month without historical movements', async () => {
    const service = createService({});

    await expect(service.exportGroupCsv('uid-1', 2025, 6)).rejects.toThrow(
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

    const file = await service.exportGroupCsv('uid-1', 2025, 6);

    expect(file.content).toContain('Seguro ""auto""');
    expect(file.content).toContain('"No"');
    expect(file.content).toContain('"Banco"');
    expect(file.content).toContain('"Rendimiento"');
    expect(file.content).toContain('"Mercado Pago"');
    expect(file.content).toContain('"01-07-2025"');
    expect(file.content).toContain('"Si"');
    expect(file.content).not.toContain('Futuro');
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
      investments: [],
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

    const file = await service.exportGroupCsv('uid-1', 2026, 8);

    expect(file.content).toContain('"Objetivo gastos fijos";"1158891.01"');
    expect(file.content).toContain('Fijos de m');
    expect(file.content).toContain(';"55107.28"');
    expect(file.content).toContain('"Objetivo variables";"620000"');
    expect(file.content).toContain(';"60728.07"');
    expect(file.content).toContain('"Objetivo ahorro e inversion";"600284.99"');
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
