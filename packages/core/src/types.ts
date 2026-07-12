export type SemanticActionKind =
  | 'activate'
  | 'clear-value'
  | 'dismiss'
  | 'extract'
  | 'focus'
  | 'navigate'
  | 'read'
  | 'scroll-into-view'
  | 'select-option'
  | 'set-value'
  | 'submit'
  | 'toggle';

export type CapabilityEffect =
  | 'authentication'
  | 'code-execution'
  | 'communication'
  | 'destructive'
  | 'financial'
  | 'local-mutation'
  | 'navigation'
  | 'permission-change'
  | 'read-only'
  | 'remote-mutation';

export interface ActorContext {
  actorId?: string;
  attributes?: Readonly<Record<string, unknown>>;
  roles?: readonly string[];
  sessionId?: string;
  tenantId?: string;
}

export interface IntentConstraints {
  allowedEffects?: readonly CapabilityEffect[];
  deniedEffects?: readonly CapabilityEffect[];
  origin?: string;
}

export interface Intent {
  constraints?: IntentConstraints;
  id: string;
  source: 'agent' | 'application' | 'user';
  structured?: unknown;
  text?: string;
}

export interface StableLocator {
  accessibleName?: string;
  attributes?: Readonly<Record<string, string>>;
  fallbackCss?: string;
  label?: string;
  role?: string;
  structuralPath?: readonly string[];
  testId?: string;
}

export interface SemanticNodeState {
  checked?: boolean;
  enabled?: boolean;
  expanded?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  visible: boolean;
}

export interface SemanticNode {
  actions: readonly SemanticActionKind[];
  confidence: number;
  description?: string;
  id: string;
  locator: StableLocator;
  name?: string;
  provenance: { source: 'application' | 'dom' | 'vision'; detail?: string };
  role?: string;
  state: SemanticNodeState;
  value?: unknown;
}

export interface PageObservation {
  capturedAt: string;
  nodes: readonly SemanticNode[];
  origin: string;
  title?: string;
  version: string;
}

export interface SemanticTarget {
  locator: StableLocator;
  nodeId?: string;
}

export interface ExpectedEffect {
  kind: 'navigation' | 'state-change' | 'value' | 'visibility';
  target?: SemanticTarget;
  value?: unknown;
}

export interface ActionRisk {
  effects: readonly CapabilityEffect[];
  level: 'critical' | 'high' | 'low' | 'medium';
}

export interface ActionProposal {
  confidence: number;
  expectedEffects: readonly ExpectedEffect[];
  id: string;
  input?: unknown;
  kind: SemanticActionKind;
  observationVersion: string;
  provenance: { resolver: string; model?: string };
  rationale?: string;
  risk: ActionRisk;
  target?: SemanticTarget;
}

export interface ExecutionEvidence {
  detail?: Readonly<Record<string, unknown>>;
  kind: string;
  timestamp: string;
}

export interface VerificationResult {
  confidence: number;
  evidence: readonly ExecutionEvidence[];
  reason?: string;
  success: boolean;
}

export interface SerializedError {
  code?: string;
  message: string;
  name: string;
}

export interface ActionResult {
  error?: SerializedError;
  events: readonly ExecutionEvent[];
  output?: unknown;
  proposal: ActionProposal;
  status: 'cancelled' | 'denied' | 'failed' | 'succeeded' | 'unverified';
  verification?: VerificationResult;
}

export interface TaskResult {
  actions: readonly ActionResult[];
  error?: SerializedError;
  status: 'cancelled' | 'denied' | 'failed' | 'succeeded';
  taskId: string;
}

export type PolicyDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'require-approval'; reason?: string };

export interface PolicyContext {
  actor?: ActorContext;
  intent?: Intent;
  observation: PageObservation;
}

export interface ExecutionEvent {
  actionId?: string;
  data?: Readonly<Record<string, unknown>>;
  taskId?: string;
  timestamp: string;
  type:
    | 'action.denied'
    | 'action.executed'
    | 'action.executing'
    | 'action.failed'
    | 'action.proposed'
    | 'action.verified'
    | 'approval.requested'
    | 'observation.completed'
    | 'task.cancelled'
    | 'task.completed'
    | 'task.failed'
    | 'task.started';
}

export interface ExecutionOutput {
  evidence: readonly ExecutionEvidence[];
  output?: unknown;
}
