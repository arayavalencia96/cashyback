jest.mock('./user-data-export.service', () => ({
  UserDataExportService: class UserDataExportService {},
}));
jest.mock('src/common/auth/firebase-auth.guard', () => ({
  FirebaseAuthGuard: class FirebaseAuthGuard {},
}));

import type { Response } from 'express';

import { UserDataExportController } from './user-data-export.controller';
import type { UserDataExportService } from './user-data-export.service';

describe('UserDataExportController', () => {
  it('returns the generated Excel workbook as a download', async () => {
    const content = Buffer.from('xlsx');
    const generate = jest.fn().mockResolvedValue({
      fileName: 'datos_de_cashy_04_08_2026.xlsx',
      content,
    });
    const service = {
      generate,
    } as unknown as UserDataExportService;
    const setHeader = jest.fn();
    const send = jest.fn();
    const status = jest.fn(() => ({ send }));
    const response = { setHeader, status } as unknown as Response;
    const controller = new UserDataExportController(service);

    await controller.download({ uid: 'usuario_1' }, response);

    expect(generate).toHaveBeenCalledWith('usuario_1');
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith(content);
  });
});
