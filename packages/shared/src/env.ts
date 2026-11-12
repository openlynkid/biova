// SSR dev (Vite) and drizzle-kit run on Node, where the `Bun` global does not
// exist. Read env from whichever runtime is present so shared packages work in
// the Bun server, the Node SSR worker and tests.
type BunRuntime = { env?: Record<string, string | undefined> };

export function readEnv(key: string): string | undefined {
  const bun = (globalThis as { Bun?: BunRuntime }).Bun;
  return bun?.env?.[key] ?? process.env[key];
}
