import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
  errorType: string;
}

export interface ValidationExceptionMetadata {
  dtoName: string;
  issues: ValidationIssue[];
}

interface ValidationExceptionWithMetadata extends BadRequestException {
  __validationMetadata?: ValidationExceptionMetadata;
}

const VALIDATION_METADATA_KEY = '__validationMetadata';

const toValidationCode = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();

const flattenValidationErrors = (
  errors: ValidationError[],
  parentPath = '',
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  for (const error of errors) {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const constraints = error.constraints || {};

    for (const [constraintName, message] of Object.entries(constraints)) {
      issues.push({
        field,
        code: toValidationCode(constraintName),
        message,
        errorType: constraintName,
      });
    }

    if (Array.isArray(error.children) && error.children.length > 0) {
      issues.push(...flattenValidationErrors(error.children, field));
    }
  }

  return issues;
};

const attachValidationMetadata = (
  exception: BadRequestException,
  metadata: ValidationExceptionMetadata,
): void => {
  Object.defineProperty(exception, VALIDATION_METADATA_KEY, {
    configurable: false,
    enumerable: false,
    value: metadata,
    writable: false,
  });
};

export const getValidationExceptionMetadata = (
  exception: unknown,
): ValidationExceptionMetadata | undefined =>
  (exception as ValidationExceptionWithMetadata | undefined)?.__validationMetadata;

export const createGlobalValidationPipe = (): ValidationPipe =>
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: false,
    forbidUnknownValues: true,
    stopAtFirstError: false,
    exceptionFactory: (errors: ValidationError[] = []) => {
      const issues = flattenValidationErrors(errors);
      const exception = new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '请求参数校验失败',
        errors: issues,
      });

      attachValidationMetadata(exception, {
        dtoName: errors[0]?.target?.constructor?.name || 'UnknownDto',
        issues,
      });

      return exception;
    },
  });
