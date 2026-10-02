import { config } from '../config/index.js';
import { RemoteHttpAgent } from './remoteHttpAgent.js';
import type { AnalysisAgent } from './types.js';

/**
 * Registro de agentes que participan en el pipeline.
 *
 * Para añadir un agente local (p. ej. uno que use un LLM):
 *   agentRegistry.register(new MiAgenteCopywriter());
 * Para añadir agentes de la FÁBRICA: AGENT_ENDPOINTS=url1,url2 en .env
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AnalysisAgent>();

  register(agent: AnalysisAgent): this {
    this.agents.set(agent.id, agent);
    return this;
  }

  unregister(id: string): void {
    this.agents.delete(id);
  }

  list(): AnalysisAgent[] {
    return [...this.agents.values()];
  }
}

export const agentRegistry = new AgentRegistry();

for (const endpoint of config.agentFactory.agentEndpoints) {
  try {
    agentRegistry.register(new RemoteHttpAgent(endpoint, config.agentFactory.token));
  } catch {
    console.error(`[agents] Endpoint inválido en AGENT_ENDPOINTS: ${endpoint}`);
  }
}
