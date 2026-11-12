// Small result type for domain services. Services return failures instead of
// throwing so HTTP adapters can map them to status codes without try/catch
// around every call. Unexpected errors still throw and reach the error handler.
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const fail = <E>(error: E): Result<never, E> => ({ ok: false, error });
