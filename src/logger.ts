export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function emit(level: LogLevel, message: string, details?: unknown): void {
  if (ORDER[level] < ORDER[currentLevel]) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  if (details === undefined) stream(line);
  else stream(line, details);
}

export const logger = {
  debug: (message: string, details?: unknown) => emit('debug', message, details),
  info: (message: string, details?: unknown) => emit('info', message, details),
  warn: (message: string, details?: unknown) => emit('warn', message, details),
  error: (message: string, details?: unknown) => emit('error', message, details),
};
