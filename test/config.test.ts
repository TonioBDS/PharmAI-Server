import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/app.js';
import { loadConfig, withOptions } from '../src/config.js';

describe('options de Home Assistant', () => {
  it('prennent le pas sur les variables d’environnement', () => {
    const env = withOptions({ ALLOW_REGISTRATION: 'true', LOG_LEVEL: 'debug' }, { allow_registration: false, inactive_days: 365, log_level: 'warn' });
    const config = loadConfig(env);
    expect(config).toMatchObject({ allowRegistration: false, inactiveDays: 365, logLevel: 'warn' });
  });

  it('ignorent les valeurs absentes ou invalides', () => {
    const env = withOptions({ INACTIVE_DAYS: '30' }, { inactive_days: -1, log_level: '' });
    expect(loadConfig(env)).toMatchObject({ allowRegistration: true, inactiveDays: 30, logLevel: 'info' });
    expect(withOptions({ A: '1' }, null)).toEqual({ A: '1' });
  });
});

describe('app Home Assistant', () => {
  it('a la même version que le serveur (image publiée correspondante)', () => {
    const yaml = readFileSync(new URL('../home-assistant/pharmai-server/config.yaml', import.meta.url), 'utf8');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(yaml).toContain(`version: "${VERSION}"`);
    expect(pkg.version).toBe(VERSION);
    expect(readFileSync(new URL('../home-assistant/pharmai-server/CHANGELOG.md', import.meta.url), 'utf8')).toContain(`## ${VERSION}`);
  });
});
