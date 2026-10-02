import type { AuditResult, BusinessProfile, Finding, Opportunity, WebsiteAnalysis } from '../domain/types.js';
import type { Vertical } from '../domain/verticals.js';

export interface AuditContext {
  profile: BusinessProfile;
  website?: WebsiteAnalysis;
  vertical: Vertical;
  metrics: AuditResult['metrics'];
}

export interface RuleOutput {
  findings: Finding[];
  opportunities: Opportunity[];
}

/** Una regla de auditoría: pura, sin E/S. Fácil de testear y de sustituir por un agente. */
export type AuditRule = (ctx: AuditContext) => RuleOutput;

export function collector(source: string) {
  const out: RuleOutput = { findings: [], opportunities: [] };
  return {
    out,
    finding(f: Omit<Finding, 'source'>) {
      out.findings.push({ ...f, source });
    },
    opportunity(o: Omit<Opportunity, 'source'>) {
      out.opportunities.push({ ...o, source });
    },
  };
}
