// Reads a required setting from .env.local and fails loudly if it's missing.
export function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing setting ${name}. Add it to .env.local (see .env.example).`);
  }
  return value;
}

export function appUrl(): string {
  return env('APP_URL').replace(/\/$/, '');
}
