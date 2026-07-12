import type {
  ActionProposal,
  ExecutionEvent,
  ExecutionOutput,
  Intent,
  PageObservation,
  PolicyContext,
  PolicyDecision,
  VerificationResult,
} from './types.js';

export interface Observer {
  observe(options?: { signal?: AbortSignal }): Promise<PageObservation>;
}

export interface ActionResolver {
  readonly name: string;
  resolve(
    intent: Intent,
    observation: PageObservation,
    options?: { signal?: AbortSignal },
  ): Promise<ActionProposal | { completed: true; output?: unknown }>;
}

export interface ProposalValidator {
  validate(
    proposal: ActionProposal,
    observation: PageObservation,
  ): Promise<{ valid: true } | { valid: false; reason: string }>;
}

export interface Policy {
  evaluate(proposal: ActionProposal, context: PolicyContext): Promise<PolicyDecision>;
}

export interface ApprovalHandler {
  request(
    proposal: ActionProposal,
    context: PolicyContext,
    reason?: string,
  ): Promise<'approved' | 'denied'>;
}

export interface Executor {
  execute(proposal: ActionProposal, options?: { signal?: AbortSignal }): Promise<ExecutionOutput>;
}

export interface Verifier {
  verify(
    proposal: ActionProposal,
    execution: ExecutionOutput,
    options?: { signal?: AbortSignal },
  ): Promise<VerificationResult>;
}

export type EventSubscriber = (event: ExecutionEvent) => void | Promise<void>;
