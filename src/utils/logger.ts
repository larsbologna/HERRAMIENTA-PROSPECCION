type Level = 'debug' | 'info' | 'warn' | 'error';

function log(level: Level, scope: string, message: string, extra?: unknown): void {
  if (level === 'debug' && !process.env.DEBUG) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} [${scope}] ${message}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  extra === undefined ? out(line) : out(line, extra);
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => log('debug', scope, msg, extra),
    info: (msg: string, extra?: unknown) => log('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => log('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => log('error', scope, msg, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
