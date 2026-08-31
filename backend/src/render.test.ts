import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { envSchema } from './env.js';

// Drift guard for the Render Blueprint (../render.yaml). The backend fails fast at boot
// if any key in envSchema is missing (see env.ts / loadEnv), so a key added to the schema
// without a matching render.yaml entry would crash-loop the deployed service. This test
// makes that a red build instead.

type EnvVar =
  | { key: string; value?: string; sync?: boolean; fromDatabase?: unknown; fromService?: unknown }
  | { fromGroup: string };

type RenderService = {
  type: string;
  name: string;
  envVars?: EnvVar[];
  healthCheckPath?: string;
  dockerfilePath?: string;
  autoDeploy?: boolean;
  branch?: string;
  dockerCommand?: string;
};

type RenderBlueprint = {
  services?: RenderService[];
  databases?: { name: string; postgresMajorVersion?: string }[];
  envVarGroups?: { name: string; envVars: EnvVar[] }[];
};

const blueprint = parse(
  readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8'),
) as RenderBlueprint;

const groups = new Map<string, Set<string>>(
  (blueprint.envVarGroups ?? []).map((g) => [
    g.name,
    new Set(g.envVars.map((e) => ('key' in e ? e.key : '')).filter(Boolean)),
  ]),
);

/** Every env key a service receives: its own entries plus any referenced group's keys. */
function keysFor(service: RenderService): Set<string> {
  const keys = new Set<string>();
  for (const entry of service.envVars ?? []) {
    if ('fromGroup' in entry) {
      for (const k of groups.get(entry.fromGroup) ?? []) keys.add(k);
    } else if (entry.key) {
      keys.add(entry.key);
    }
  }
  return keys;
}

const requiredEnvKeys = Object.keys(envSchema.shape);
const service = (name: string): RenderService => {
  const found = blueprint.services?.find((s) => s.name === name);
  if (!found) throw new Error(`render.yaml has no service named ${name}`);
  return found;
};

describe('render.yaml blueprint', () => {
  it('references an env var group that actually exists for every fromGroup', () => {
    for (const s of blueprint.services ?? []) {
      for (const entry of s.envVars ?? []) {
        if ('fromGroup' in entry) expect(groups.has(entry.fromGroup)).toBe(true);
      }
    }
  });

  it.each(['discovery-engine-backend', 'discovery-engine-ingest-worker'])(
    '%s is given every env key env.ts requires at boot',
    (name) => {
      const provided = keysFor(service(name));
      const missing = requiredEnvKeys.filter((k) => !provided.has(k));
      expect(missing).toEqual([]);
    },
  );

  it('keeps DATABASE_URL and REDIS_URL as managed-resource refs, not literal values', () => {
    for (const name of ['discovery-engine-backend', 'discovery-engine-ingest-worker']) {
      const entries = service(name).envVars ?? [];
      const db = entries.find((e) => 'key' in e && e.key === 'DATABASE_URL');
      const redis = entries.find((e) => 'key' in e && e.key === 'REDIS_URL');
      expect(db && 'fromDatabase' in db).toBe(true);
      expect(redis && 'fromService' in redis).toBe(true);
    }
  });

  it('never hard-codes a secret value in the blueprint', () => {
    const secretKeys = ['ANTHROPIC_API_KEY', 'VOYAGE_API_KEY', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'];
    for (const group of blueprint.envVarGroups ?? []) {
      for (const entry of group.envVars) {
        if ('key' in entry && secretKeys.includes(entry.key)) {
          expect(entry.sync).toBe(false);
          expect('value' in entry).toBe(false);
        }
      }
    }
  });

  it('wires the web service for Docker + health checks + auto-deploy on main', () => {
    const web = service('discovery-engine-backend');
    expect(web.type).toBe('web');
    expect(web.dockerfilePath).toBe('./backend/Dockerfile');
    expect(web.healthCheckPath).toBe('/health');
    expect(web.autoDeploy).toBe(true);
    expect(web.branch).toBe('main');
  });

  it('runs the worker with the ingestion-worker entrypoint and auto-deploy on main', () => {
    const worker = service('discovery-engine-ingest-worker');
    expect(worker.type).toBe('worker');
    expect(worker.dockerCommand).toBe('node dist/scripts/ingest-worker.js');
    expect(worker.autoDeploy).toBe(true);
    expect(worker.branch).toBe('main');
  });

  it('provisions Postgres 16 for pgvector', () => {
    const db = blueprint.databases?.find((d) => d.name === 'discovery-engine-db');
    expect(db?.postgresMajorVersion).toBe('16');
  });
});
