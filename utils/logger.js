import winston from "winston";

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const isProduction = process.env.NODE_ENV === "production";

// Development: human-readable colorized output (matches existing chalk style)
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack }) => {
    return stack
      ? `[${timestamp}] ${level}: ${message}\n${stack}`
      : `[${timestamp}] ${level}: ${message}`;
  })
);

// Production: structured JSON — readable in Vercel Function Logs dashboard
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = winston.createLogger({
  level: isProduction ? "info" : "debug",
  format: isProduction ? prodFormat : devFormat,
  transports: [
    // Console transport only — Vercel captures stdout/stderr from function logs.
    // File transports are not useful in serverless environments.
    new winston.transports.Console(),
  ],
});

export default logger;
