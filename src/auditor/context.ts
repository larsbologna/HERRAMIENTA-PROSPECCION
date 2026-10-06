import type { AuditResult, BusinessProfile, Finding, Opportunity, WebsiteAnalysis } from '../domain/types.js';
import type { Vertical } from '../domain/verticals.js';
import type { ChannelReport } from '../channels/crossCheck.js';

export interface AuditContext {
  profile: BusinessProfile;
  website?: WebsiteAnalysis;
  vertical: Vertical;
  metrics: AuditResult['metrics'];
  /** Canales verificados (Maps + web + Instagram). Sin ellos, todo se comporta como antes. */
  channels?: ChannelReport;
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
