import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Tenant } from '../types';
import { getConfig } from '../config';

// ============================================================
// TenantStore
//
// Responsible for:
//   - Loading tenant definitions from JSON config
//   - Resolving inbound API keys → Tenant
//   - Caching tenant lookups (hot path: every request hits this)
//
// TODO: Add file watcher to hot-reload config without restart
// TODO: Replace JSON backend with PostgreSQL for production
// ============================================================

export class TenantStore {
  private tenants: Map<string, Tenant> = new Map();
  private apiKeyIndex: Map<string, string> = new Map(); // hashed key → tenantId

  constructor(private configPath: string) {}

  async load(): Promise<void> {
    const resolved = path.resolve(this.configPath);

    if (!fs.existsSync(resolved)) {
      throw new Error(`Tenant config not found at ${resolved}`);
    }

    const raw = fs.readFileSync(resolved, 'utf-8');
    const data = JSON.parse(raw) as { tenants: Tenant[] };

    this.tenants.clear();
    this.apiKeyIndex.clear();

    for (const tenant of data.tenants) {
      this.tenants.set(tenant.id, {
        ...tenant,
        createdAt: new Date(tenant.createdAt),
      });

      for (const key of tenant.apiKeys) {
        this.apiKeyIndex.set(key, tenant.id);
      }
    }
  }

  resolveApiKey(rawKey: string): Tenant | null {
    // Keys in config are stored as SHA-256 hashes
    const hashed = crypto.createHash('sha256').update(rawKey).digest('hex');
    const tenantId = this.apiKeyIndex.get(hashed);
    if (!tenantId) return null;
    return this.tenants.get(tenantId) ?? null;
  }

  getTenant(id: string): Tenant | null {
    return this.tenants.get(id) ?? null;
  }

  listTenants(): Tenant[] {
    return Array.from(this.tenants.values());
  }

  getTenantCount(): number {
    return this.tenants.size;
  }
}

// Singleton
let _store: TenantStore | null = null;

export async function getTenantStore(): Promise<TenantStore> {
  if (!_store) {
    const config = getConfig();
    _store = new TenantStore(config.TENANT_CONFIG_PATH);
    await _store.load();
  }
  return _store;
}
