import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch(HttpException)
export class IntegrationExceptionFilter implements ExceptionFilter<HttpException> {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const status = exception.getStatus();
    host.switchToHttp().getResponse<Response>().status(status).json({
      result: null,
      message: exception.message,
      description: 'Integration request could not be completed.',
      statuscode: status,
      ok: false,
    });
  }
}
