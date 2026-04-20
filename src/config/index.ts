import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  PORT: z.string().default('8080').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Upstream providers
  OPENAI_BASE_URL: z.string().default('https://api.openai.com'),
  ANTHROPIC_BASE_URL: z.string().default('https://api.anthropic.com'),

  // Storage
  TENANT_CONFIG_PATH: z.string().default('./config/tenants.json'),
  POLICY_CONFIG_PATH: z.string().default('./config/policies.json'),

  // Redis (optional — falls back to in-memory if not set)
  REDIS_URL: z.string().optional(),

  // Anomaly detection webhooks
  ALERT_WEBHOOK_URL: z.string().optional(),
  ALERT_WEBHOOK_SECRET: z.string().optional(),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('llm-gateway'),

  // Admin API
  ADMIN_API_KEY: z.string().min(32, 'ADMIN_API_KEY must be at least 32 characters'),

  // Rate limiting defaults (overridden per-tenant)
  DEFAULT_RPM: z.string().default('60').transform(Number),
  DEFAULT_DAILY_CAP_USD: z.string().default('10').transform(Number),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (_config) return _config;

  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${issues}`);
  }

  _config = result.data;
  return _config;
}

export function getConfig(): AppConfig {
  if (!_config) throw new Error('Config not loaded. Call loadConfig() first.');
  return _config;
}
