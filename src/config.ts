export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Autorise la création de nouveaux foyers sans invitation (serveur personnel : true). */
  allowRegistration: boolean;
  /** Taille maximale d'une modification chiffrée, en octets (après décodage base64). */
  maxChangeBytes: number;
  /** Taille maximale d'un fichier chiffré (photo), en octets */
  maxBlobBytes: number;
  /** Durée de validité d'une invitation, en heures. */
  inviteTtlHours: number;
  /** Tentatives par minute et par adresse sur les routes sans jeton (création de foyer, invitation). */
  publicRateLimit: number;
  /**
   * Foyers sans aucune connexion depuis ce nombre de jours : effacés du serveur
   * (les téléphones gardent leurs données). 0 : jamais (par défaut).
   */
  inactiveDays: number;
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
  // Sans DATABASE_URL : un fichier SQLite dans DATA_DIR (auto-hébergement, rien d'autre à installer)
  const databaseUrl = env.DATABASE_URL || `sqlite:${env.DATA_DIR ?? './data'}/pharmai.db`;
  return {
    port: int(env.PORT, 8080),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl,
    allowRegistration: bool(env.ALLOW_REGISTRATION, true),
    maxChangeBytes: int(env.MAX_CHANGE_BYTES, 256 * 1024),
    maxBlobBytes: int(env.MAX_BLOB_BYTES, 3 * 1024 * 1024),
    inviteTtlHours: int(env.INVITE_TTL_HOURS, 24),
    publicRateLimit: int(env.PUBLIC_RATE_LIMIT, 20),
    inactiveDays: int(env.INACTIVE_DAYS, 0),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
