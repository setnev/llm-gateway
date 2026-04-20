import * as fs from 'fs';
import * as path from 'path';
import { PolicyRule, PolicySet, PolicyVerdict, PolicyAction, GatewayRequest, RuleType } from '../types';
import { getConfig } from '../config';

// ============================================================
// PolicyEngine
//
// Evaluates a GatewayRequest against a PolicySet and returns
// a PolicyVerdict (ALLOW / BLOCK / CHALLENGE).
//
// Rules are grouped by type and sorted by priority within each group.
// Evaluation MUST short-circuit on first BLOCK verdict.
//
// Current state:
//   - PolicySet loading from JSON: COMPLETE
//   - Rule type implementations: INCOMPLETE (see stubs below)
//   - Short-circuit logic: NOT IMPLEMENTED
//   - Async rule support: NOT IMPLEMENTED (reserved for ML classifiers)
//
// Rule evaluation order (enforced by priority field, lower = first):
//   1. rate_limit       (fastest, no I/O)
//   2. cost_cap         (in-memory lookup)
//   3. model_restriction (config lookup)
//   4. prompt_length    (string length check)
//   5. pii_detection    (regex scan — most expensive)
//   6. content_filter   (keyword scan)
// ============================================================

// ---- Rule evaluator interface ----

type RuleEvaluator = (
  rule: PolicyRule,
  request: GatewayRequest,
  context: EvaluationContext
) => Promise<PolicyAction | null>; // null = rule does not apply / abstain

interface EvaluationContext {
  tenantDailySpendUsd: number;
  tenantRequestsThisMinute: number;
}

// ---- PII patterns ----
// These are intentionally basic. A production implementation would
// use a dedicated library or ML model.
const PII_PATTERNS: Record<string, RegExp> = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/,
  credit_card: /\b(?:\d[ -]?){13,16}\b/,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  phone_us: /\b(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
};

// ---- Rule evaluators ----
// Each evaluator returns:
//   - PolicyAction  → override with this action
//   - null          → abstain (rule doesn't apply or passes)

const evaluators: Record<RuleType, RuleEvaluator> = {
  pii_detection: async (rule, request, _ctx) => {
    const body = JSON.stringify(request.requestBody);
    const patterns = (rule.config.patterns as string[]) ?? Object.keys(PII_PATTERNS);

    for (const patternName of patterns) {
      const regex = PII_PATTERNS[patternName];
      if (regex && regex.test(body)) {
        return rule.action;
      }
    }
    return null;
  },

  content_filter: async (rule, request, _ctx) => {
    const keywords = (rule.config.keywords as string[]) ?? [];
    const body = JSON.stringify(request.requestBody).toLowerCase();

    for (const keyword of keywords) {
      if (body.includes(keyword.toLowerCase())) {
        return rule.action;
      }
    }
    return null;
  },

  // TODO: Implement cost_cap evaluator.
  // config shape: { dailyCapUsd: number }
  // Should compare ctx.tenantDailySpendUsd against config.dailyCapUsd.
  // Return rule.action if over cap, null otherwise.
  cost_cap: async (_rule, _request, _ctx) => {
    throw new Error('Not implemented: cost_cap evaluator');
  },

  // TODO: Implement rate_limit evaluator.
  // Should check ctx.tenantRequestsThisMinute against config.requestsPerMinute.
  // Return rule.action if over limit, null otherwise.
  rate_limit: async (_rule, _request, _ctx) => {
    throw new Error('Not implemented: rate_limit evaluator');
  },

  // TODO: Implement model_restriction evaluator.
  // config shape: { allowedModels: string[] }
  // Block if request.requestBody.model is not in allowedModels.
  model_restriction: async (_rule, _request, _ctx) => {
    throw new Error('Not implemented: model_restriction evaluator');
  },

  // TODO: Implement prompt_length evaluator.
  // config shape: { maxChars: number }
  // Measure total character length of all message content fields.
  prompt_length: async (_rule, _request, _ctx) => {
    throw new Error('Not implemented: prompt_length evaluator');
  },
};

// ---- PolicyEngine ----

export class PolicyEngine {
  private policySets: Map<string, PolicySet> = new Map();

  async load(configPath: string): Promise<void> {
    const resolved = path.resolve(configPath);

    if (!fs.existsSync(resolved)) {
      throw new Error(`Policy config not found at ${resolved}`);
    }

    const raw = fs.readFileSync(resolved, 'utf-8');
    const data = JSON.parse(raw) as { policySets: PolicySet[] };

    this.policySets.clear();

    for (const ps of data.policySets) {
      // Sort rules by priority ascending before storing
      ps.rules = ps.rules
        .filter(r => r.enabled)
        .sort((a, b) => a.priority - b.priority);

      this.policySets.set(ps.id, ps);
    }
  }

  getPolicySet(id: string): PolicySet | null {
    return this.policySets.get(id) ?? null;
  }

  // TODO: Implement evaluate().
  //
  // Accepts a GatewayRequest, policySetId, and EvaluationContext.
  // Must:
  //   1. Look up the PolicySet (return ALLOW with reason 'no_policy' if not found)
  //   2. Iterate rules IN PRIORITY ORDER
  //   3. For each rule, call the matching evaluator from `evaluators`
  //   4. SHORT-CIRCUIT immediately if any evaluator returns 'BLOCK'
  //   5. Track how many rules were evaluated
  //   6. If no rule triggered, return policySet.defaultAction
  //   7. Record latencyMs from start to finish
  //
  // Return type: Promise<PolicyVerdict>
  async evaluate(
    _request: GatewayRequest,
    _policySetId: string,
    _context: EvaluationContext
  ): Promise<PolicyVerdict> {
    throw new Error('Not implemented: PolicyEngine.evaluate()');
  }
}

// Singleton
let _engine: PolicyEngine | null = null;

export async function getPolicyEngine(): Promise<PolicyEngine> {
  if (!_engine) {
    const config = getConfig();
    _engine = new PolicyEngine();
    await _engine.load(config.POLICY_CONFIG_PATH);
  }
  return _engine;
}
