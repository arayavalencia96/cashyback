jest.mock('src/common/services/firebase.service', () => ({
  FirebaseAdminService: class FirebaseAdminService {},
}));

import type { FirebaseAdminService } from 'src/common/services/firebase.service';
import ExcelJS from 'exceljs';

import { UserDataExportService } from './user-data-export.service';

describe('UserDataExportService', () => {
  const documents: Record<
    string,
    Array<{ id: string; data: Record<string, unknown> }>
  > = {
    monthlyBudgets: [
      {
        id: 'presupuesto_1',
        data: {
          userId: 'usuario_1',
          monthKey: '2026-08',
          month: 8,
          year: 2026,
          salary: 1000000,
          createdAt: '2026-07-01T16:15:32.538Z',
          updatedAt: '2026-07-01T16:15:32.538Z',
          salaryComponents: [{ reason: 'Sueldo', amount: 1000000 }],
        },
      },
    ],
    fixedExpenses: [
      {
        id: 'gasto_fijo_1',
        data: {
          userId: 'usuario_1',
          description: 'Alquiler',
          category: 'Alquiler',
          amount: 300000,
          expenseDate: '2026-08-01',
          createdAt: '2026-08-01T16:15:32.538Z',
          paymentStatus: 'pending',
          punctualExpenses: [{ description: 'Compra puntual', amount: 5000 }],
        },
      },
    ],
    variableExpenses: [],
    investments: [],
    user_legal_consents: [],
    privacy_requests: [],
  };

  const firestore = {
    collection: jest.fn((collectionName: string) => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          id: 'usuario_1',
          data: () => ({
            email: 'usuario@cashy.app',
            displayName: 'Usuario Cashy',
            theme: 'dark',
          }),
        }),
      })),
      where: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          docs: (documents[collectionName] ?? []).map((document) => ({
            id: document.id,
            data: () => document.data,
          })),
        }),
      })),
    })),
  };

  const firebaseAdminService = {
    firestore,
    getUser: jest.fn().mockResolvedValue({
      email: 'usuario@cashy.app',
      displayName: 'Usuario Cashy',
      emailVerified: true,
      disabled: false,
      metadata: {
        creationTime: '2026-01-01T00:00:00.000Z',
        lastSignInTime: '2026-08-04T10:00:00.000Z',
      },
    }),
  } as unknown as FirebaseAdminService;

  it('generates one Excel workbook with Spanish sheets, typed dates and snake_case headers', async () => {
    const service = new UserDataExportService(firebaseAdminService);

    const result = await service.generate('usuario_1');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.content);
    const fixedExpenses = workbook.getWorksheet('gastos_fijos');
    const budgets = workbook.getWorksheet('presupuestos_mensuales');

    expect(result.fileName).toMatch(/^datos_de_cashy_\d{2}_\d{2}_\d{4}\.xlsx$/);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'informacion',
      'datos_de_la_cuenta',
      'presupuestos_mensuales',
      'ingresos_mensuales',
      'gastos_fijos',
      'gastos_puntuales',
      'gastos_variables',
      'inversiones',
      'consentimientos_legales',
      'solicitudes_de_privacidad',
    ]);
    expect(fixedExpenses?.getRow(1).values).toContain('estado_pago');
    expect(fixedExpenses?.getRow(2).values).toContain('pendiente');
    expect(budgets?.getCell('L2').value).toBeInstanceOf(Date);
    expect(budgets?.getCell('L2').numFmt).toBe('dd/mm/yyyy hh:mm:ss');
    expect((budgets?.getCell('L2').value as Date).toISOString()).toBe(
      '2026-07-01T13:15:32.000Z',
    );
  });
});
