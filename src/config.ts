export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Autorise la création de nouveaux foyers sans invitation (serveur personnel : true). */
  allowRegistration: boolean;
  /** Taille maximale d'une modification chiffrée, en octets (après décodage base64). */
  maxChangeBytes: number;
  /** Durée de validité d'une invitation, en heures. */
  inviteTtlHours: number;
  logLevel: string;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL est requis (ex. postgres://pharmai:secret@localhost:5432/pharmai)');
  return {
    port: int(env.PORT, 8080),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl,
    allowRegistration: bool(env.ALLOW_REGISTRATION, true),
    maxChangeBytes: int(env.MAX_CHANGE_BYTES, 256 * 1024),
    inviteTtlHours: int(env.INVITE_TTL_HOURS, 24),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
