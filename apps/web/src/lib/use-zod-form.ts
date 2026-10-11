'use client';

import { useForm, type DefaultValues, type FieldValues, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { zodResolver, type ResolverOptions } from './forms';

/** react-hook-form validated by a zod schema of packages/shared; errors show when a field is left. */
export function useZodForm<
  Schema extends z.ZodType,
  Values extends FieldValues = z.input<Schema> & FieldValues,
>(
  schema: Schema,
  defaultValues: DefaultValues<Values>,
  options?: ResolverOptions<Values>,
): UseFormReturn<Values, unknown, z.output<Schema>> {
  return useForm<Values, unknown, z.output<Schema>>({
    resolver: zodResolver<Schema, Values>(schema, options),
    defaultValues,
    mode: 'onTouched',
  });
}
