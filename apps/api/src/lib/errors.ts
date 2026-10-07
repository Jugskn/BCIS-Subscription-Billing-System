export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options?: { expose?: boolean; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.expose = options?.expose ?? statusCode < 500;
  }
}

export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) return true;
  // Vitest/tsx can duplicate the class across module graphs; duck-type as fallback.
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AppError" &&
    typeof (error as { statusCode?: unknown }).statusCode === "number" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

export const friendlyMessages: Record<number, string> = {
  400: "The request could not be understood. Please check your input.",
  401: "Please sign in to continue.",
  403: "You do not have permission to perform this action.",
  404: "The requested resource was not found.",
  409: "This action conflicts with the current state.",
  423: "This account is temporarily locked. Try again later.",
  500: "Something went wrong. Please try again or contact an administrator.",
};
