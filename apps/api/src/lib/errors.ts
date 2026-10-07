export type ValidationIssue = { field: string; message: string };

export function zodValidationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): ValidationIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join(".") || "_root",
    message: issue.message,
  }));
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;
  readonly issues?: ValidationIssue[];

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options?: { expose?: boolean; cause?: unknown; issues?: ValidationIssue[] },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.expose = options?.expose ?? statusCode < 500;
    this.issues = options?.issues;
  }
}

/** Prefer for Zod safeParse failures so the client gets field-level issues. */
export function validationError(
  message: string,
  zodError: { issues: Array<{ path: PropertyKey[]; message: string }> },
): AppError {
  return new AppError(400, "VALIDATION_ERROR", message, {
    issues: zodValidationIssues(zodError),
  });
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
