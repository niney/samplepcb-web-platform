import { z } from 'zod';

export const ApiError = z.object({ error: z.string(), message: z.string() });
export type ApiErrorType = z.infer<typeof ApiError>;

export const HealthResponse = z.object({ ok: z.literal(true), service: z.string() });
export type HealthResponseType = z.infer<typeof HealthResponse>;
