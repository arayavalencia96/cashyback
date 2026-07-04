import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let envLoaded = false;

export const loadDotEnv = (): void => {
  if (envLoaded) {
    return;
  }

  envLoaded = true;

  const envPath = resolve(process.cwd(), '.env');

  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value.replace(/^["']|["']$/g, '');
  }
};

export const readRequiredEnv = (name: string): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

export const readOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name];

  return value && value.length > 0 ? value : undefined;
};
