import { BadRequestException } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';

/** Parses with a Zod schema, or throws a 400 whose body lists field errors the UI can show inline. */
export function parseOrThrow<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown, prefix?: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new BadRequestException({
    message: 'Validation failed',
    issues: result.error.issues.map((issue) => ({
      path: [...(prefix ? [prefix] : []), ...issue.path].join('.'),
      message: issue.message,
    })),
  });
}
