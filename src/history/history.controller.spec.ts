jest.mock('src/common/auth/firebase-auth.guard', () => ({
  FirebaseAuthGuard: class FirebaseAuthGuard {},
}));
jest.mock('./history.service', () => ({
  HistoryService: class HistoryService {},
}));

import type { Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

describe('HistoryController', () => {
  const historyServiceMock = {
    exportGroupCsv: jest.fn(),
  };
  const controller = new HistoryController(
    historyServiceMock as unknown as HistoryService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exports the requested history group as a CSV response', async () => {
    const user = { uid: 'uid-1' } as DecodedIdToken;
    const setHeader = jest.fn();
    const send = jest.fn();
    const status = jest.fn().mockReturnValue({ send });
    const response = {
      setHeader,
      status,
      send,
    } as unknown as Response;
    historyServiceMock.exportGroupCsv.mockResolvedValue({
      fileName: 'cashy-history.csv',
      content: 'csv-content',
    });

    await controller.exportCsv(user, 2026, 6, response);

    expect(historyServiceMock.exportGroupCsv).toHaveBeenCalledWith(
      'uid-1',
      2026,
      6,
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="cashy-history.csv"',
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith('csv-content');
  });
});
