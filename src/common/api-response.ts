export interface ApiResponse<T> {
  result: T;
  message: string;
  description: string;
  statuscode: number;
  ok: boolean;
}

export interface ApiErrorResponse {
  result: null;
  message: string;
  description: string;
  statuscode: number;
  ok: false;
}

export const buildSuccessResponse = <T>(
  result: T,
  message: string,
  description: string,
  statuscode: number,
): ApiResponse<T> => ({
  result,
  message,
  description,
  statuscode,
  ok: true,
});

export const buildErrorResponse = (
  message: string,
  description: string,
  statuscode: number,
): ApiErrorResponse => ({
  result: null,
  message,
  description,
  statuscode,
  ok: false,
});
