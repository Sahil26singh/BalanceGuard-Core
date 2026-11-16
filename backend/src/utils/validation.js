import { z } from 'zod';

const MAX_BIGINT = 9223372036854775807n;

/**
 * Validates monetary amounts (paise) with full precision safety:
 * 1. Accepts string representations of positive integers (e.g., "1000", "9007199254740993").
 * 2. Accepts standard JavaScript safe integers (e.g., 1000).
 * 3. Rejects raw numbers exceeding Number.MAX_SAFE_INTEGER to prevent silent precision loss.
 * 4. Ensures the value fits within PostgreSQL's signed 64-bit BIGINT range.
 * 5. Returns a clean string representing the exact integer for BigInt calculations.
 */
export const amountSchema = z
  .union([
    z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer in paise (digits only)'),
    z.number().int().positive('Amount must be a positive integer in paise')
  ])
  .superRefine((val, ctx) => {
    if (typeof val === 'number') {
      if (!Number.isSafeInteger(val)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Amount exceeds Number.MAX_SAFE_INTEGER. Pass large amounts as a string to prevent precision loss.'
        });
        return;
      }
    }
    try {
      const b = BigInt(val);
      if (b <= 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Amount must be greater than zero'
        });
      } else if (b > MAX_BIGINT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Amount exceeds maximum allowable 64-bit integer (9223372036854775807 paise)'
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid amount format'
      });
    }
  })
  .transform((val) => val.toString());

