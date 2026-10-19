import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch(HttpException)
export class IntegrationExceptionFilter implements ExceptionFilter<HttpException> {
  private readonly logger = new Logger(IntegrationExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const status = exception.getStatus();
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    this.logger.warn(
      JSON.stringify({
        event: 'integration_request_failed',
        method: request.method,
        path: request.originalUrl,
        statusCode: status,
        message: exception.message,
      }),
    );
    http.getResponse<Response>().status(status).json({
      result: null,
      message: exception.message,
      description: 'Integration request could not be completed.',
      statuscode: status,
      ok: false,
    });
  }
}
