export class AppError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function toPublicError(error) {
  if (error instanceof AppError) {
    return {
      message: error.message,
      details: error.details,
      statusCode: error.statusCode,
    };
  }

  return {
    message: "Something went wrong while generating the episode.",
    details: process.env.NODE_ENV === "production" ? undefined : error.message,
    statusCode: 500,
  };
}
