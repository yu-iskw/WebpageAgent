import type { Policy, ProposalValidator, Verifier } from './contracts.js';
import type { ActionProposal, PageObservation } from './types.js';

export class DefaultProposalValidator implements ProposalValidator {
  validate(
    proposal: ActionProposal,
    observation: PageObservation,
  ): Promise<{ valid: true } | { valid: false; reason: string }> {
    if (proposal.observationVersion !== observation.version) {
      return Promise.resolve({
        valid: false,
        reason: 'The proposal was resolved against stale page state.',
      });
    }
    if (!proposal.target) return Promise.resolve({ valid: true });
    if (!proposal.target.nodeId) return Promise.resolve({ valid: true });

    const target = observation.nodes.find((node) => node.id === proposal.target?.nodeId);
    if (!target)
      return Promise.resolve({
        valid: false,
        reason: 'The target is absent from the current observation.',
      });
    if (!target.state.visible)
      return Promise.resolve({ valid: false, reason: 'The target is not visible.' });
    if (target.state.enabled === false)
      return Promise.resolve({ valid: false, reason: 'The target is disabled.' });
    if (!target.actions.includes(proposal.kind)) {
      return Promise.resolve({
        valid: false,
        reason: `The target does not support ${proposal.kind}.`,
      });
    }
    return Promise.resolve({ valid: true });
  }
}

export const allowPolicy: Policy = {
  evaluate(proposal, context) {
    const allowed = context.intent?.constraints?.allowedEffects;
    const denied = context.intent?.constraints?.deniedEffects ?? [];
    const outsideAllowlist = allowed
      ? proposal.risk.effects.some((effect) => !allowed.includes(effect))
      : false;
    const explicitlyDenied = proposal.risk.effects.some((effect) => denied.includes(effect));
    if (outsideAllowlist || explicitlyDenied) {
      return Promise.resolve({
        decision: 'deny',
        reason: 'The action effects violate the intent constraints.',
      });
    }
    return Promise.resolve({ decision: 'allow' });
  },
};

export const evidenceVerifier: Verifier = {
  verify(proposal, execution) {
    if (proposal.expectedEffects.length === 0) {
      return Promise.resolve({
        confidence: execution.evidence.length > 0 ? 0.8 : 0,
        evidence: execution.evidence,
        reason: 'No explicit expected effects were declared.',
        success: false,
      });
    }
    return Promise.resolve({
      confidence: execution.evidence.length > 0 ? 0.7 : 0,
      evidence: execution.evidence,
      reason: execution.evidence.length > 0 ? undefined : 'The executor returned no evidence.',
      success: execution.evidence.length > 0,
    });
  },
};
