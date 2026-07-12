import { allowPolicy, DefaultProposalValidator, evidenceVerifier } from './defaults.js';
import { serializeError, WebpageAgentError } from './errors.js';
import { EventBus } from './event-bus.js';

import type {
  ActionResolver,
  ApprovalHandler,
  EventSubscriber,
  Executor,
  Observer,
  Policy,
  ProposalValidator,
  Verifier,
} from './contracts.js';
import type {
  ActionProposal,
  ActionResult,
  ActorContext,
  ExecutionEvent,
  Intent,
  PageObservation,
  TaskResult,
} from './types.js';

export interface WebpageAgentConfig {
  actor?: ActorContext;
  approval?: ApprovalHandler;
  clock?: () => Date;
  executor: Executor;
  idFactory?: () => string;
  observer: Observer;
  policy?: Policy;
  resolver: ActionResolver;
  validator?: ProposalValidator;
  verifier?: Verifier;
}

export interface RunOptions {
  maxActions?: number;
  maxResolutions?: number;
  mode?: 'bounded' | 'single-step';
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface WebpageAgent {
  dispose(): Promise<void>;
  execute(proposal: ActionProposal, options?: { signal?: AbortSignal }): Promise<ActionResult>;
  observe(options?: { signal?: AbortSignal }): Promise<PageObservation>;
  onEvent(subscriber: EventSubscriber): () => void;
  resolve(intent: string | Intent, options?: { signal?: AbortSignal }): Promise<ActionProposal>;
  run(intent: string | Intent, options?: RunOptions): Promise<TaskResult>;
  step(intent: string | Intent, options?: { signal?: AbortSignal }): Promise<ActionResult>;
  stop(): Promise<void>;
}

interface RuntimeState {
  disposed: boolean;
  intent?: Intent;
  taskId?: string;
}

export function createWebpageAgent(config: WebpageAgentConfig): WebpageAgent {
  const bus = new EventBus();
  const state: RuntimeState = { disposed: false };
  const controller = { current: undefined as AbortController | undefined };
  const clock = config.clock ?? (() => new Date());
  const idFactory = config.idFactory ?? (() => crypto.randomUUID());
  const validator = config.validator ?? new DefaultProposalValidator();
  const policy = config.policy ?? allowPolicy;
  const verifier = config.verifier ?? evidenceVerifier;

  const emit = async (event: Omit<ExecutionEvent, 'timestamp'>): Promise<void> => {
    await bus.emit({ ...event, timestamp: clock().toISOString() });
  };

  const ensureActive = (): void => {
    if (state.disposed) throw new WebpageAgentError('The runtime is disposed.', 'RUNTIME_DISPOSED');
  };

  const normalizeIntent = (intent: string | Intent): Intent =>
    typeof intent === 'string' ? { id: idFactory(), source: 'user', text: intent } : { ...intent };

  const observe = async (options?: { signal?: AbortSignal }): Promise<PageObservation> => {
    ensureActive();
    const observation = await config.observer.observe(options);
    await emit({
      data: { nodeCount: observation.nodes.length, version: observation.version },
      type: 'observation.completed',
    });
    return observation;
  };

  const resolveFor = async (
    intent: Intent,
    options?: { signal?: AbortSignal },
  ): Promise<ActionProposal | { completed: true; output?: unknown }> => {
    const observation = await observe(options);
    const resolution = await config.resolver.resolve(intent, observation, options);
    if ('completed' in resolution) return resolution;
    await emit({
      actionId: resolution.id,
      data: { kind: resolution.kind },
      type: 'action.proposed',
    });
    return resolution;
  };

  const resolve = async (
    value: string | Intent,
    options?: { signal?: AbortSignal },
  ): Promise<ActionProposal> => {
    const resolution = await resolveFor(normalizeIntent(value), options);
    if ('completed' in resolution) {
      throw new WebpageAgentError(
        'The resolver reported that the task is already complete.',
        'TASK_ALREADY_COMPLETE',
      );
    }
    return resolution;
  };

  const execute = async (
    proposal: ActionProposal,
    options?: { signal?: AbortSignal },
  ): Promise<ActionResult> => {
    const events: ExecutionEvent[] = [];
    const unsubscribe = bus.subscribe((event) => {
      events.push(event);
    });
    try {
      const observation = await observe(options);
      const validation = await validator.validate(proposal, observation);
      if (!validation.valid) throw new WebpageAgentError(validation.reason, 'INVALID_PROPOSAL');
      const context = { actor: config.actor, intent: state.intent, observation };
      const authorization = await authorize(proposal, context, policy, config.approval, emit);
      if (authorization === 'denied') return { events, proposal, status: 'denied' };
      await emit({ actionId: proposal.id, type: 'action.executing' });
      const output = await config.executor.execute(proposal, options);
      await emit({
        actionId: proposal.id,
        data: { evidenceCount: output.evidence.length },
        type: 'action.executed',
      });
      const verification = await verifier.verify(proposal, output, options);
      await emit({
        actionId: proposal.id,
        data: { success: verification.success },
        type: 'action.verified',
      });
      return {
        events,
        output: output.output,
        proposal,
        status: verification.success ? 'succeeded' : 'unverified',
        verification,
      };
    } catch (error) {
      const serialized = serializeError(error);
      await emit({
        actionId: proposal.id,
        data: { error: serialized.message },
        type: 'action.failed',
      });
      return {
        error: serialized,
        events,
        proposal,
        status: options?.signal?.aborted ? 'cancelled' : 'failed',
      };
    } finally {
      unsubscribe();
    }
  };

  const step = async (
    value: string | Intent,
    options?: { signal?: AbortSignal },
  ): Promise<ActionResult> => {
    const intent = normalizeIntent(value);
    state.intent = intent;
    return execute(await resolve(intent, options), options);
  };

  const run = async (value: string | Intent, options: RunOptions = {}): Promise<TaskResult> => {
    ensureActive();
    const intent = normalizeIntent(value);
    const taskId = intent.id;
    state.intent = intent;
    state.taskId = taskId;
    controller.current = new AbortController();
    const signal = mergeSignals(controller.current.signal, options.signal, options.timeoutMs);
    const maxActions = options.mode === 'bounded' ? (options.maxActions ?? 8) : 1;
    const maxResolutions = options.maxResolutions ?? maxActions + 1;
    const actions: ActionResult[] = [];
    await emit({ taskId, type: 'task.started' });
    try {
      for (let resolutionCount = 0; resolutionCount < maxResolutions; resolutionCount += 1) {
        if (signal.aborted)
          throw new WebpageAgentError('The task was cancelled.', 'TASK_CANCELLED');
        const resolution = await resolveFor(intent, { signal });
        if ('completed' in resolution) {
          await emit({ taskId, type: 'task.completed' });
          return { actions, status: 'succeeded', taskId };
        }
        assertWithinActionLimit(actions.length, maxActions);
        const result = await execute(resolution, { signal });
        actions.push(result);
        const failure = toTaskFailure(result, actions, taskId);
        if (failure) return failure;
        if (options.mode !== 'bounded') {
          await emit({ taskId, type: 'task.completed' });
          return { actions, status: 'succeeded', taskId };
        }
      }
      throw new WebpageAgentError(
        'The task exceeded its resolution limit.',
        'RESOLUTION_LIMIT_EXCEEDED',
      );
    } catch (error) {
      const serialized = serializeError(error);
      const status = signal.aborted ? 'cancelled' : 'failed';
      await emit({
        data: { error: serialized.message },
        taskId,
        type: status === 'cancelled' ? 'task.cancelled' : 'task.failed',
      });
      return { actions, error: serialized, status, taskId };
    } finally {
      controller.current = undefined;
      state.taskId = undefined;
    }
  };

  return {
    dispose() {
      controller.current?.abort();
      state.disposed = true;
      return Promise.resolve();
    },
    execute,
    observe,
    onEvent: (subscriber) => bus.subscribe(subscriber),
    resolve,
    run,
    step,
    stop() {
      controller.current?.abort();
      return Promise.resolve();
    },
  };
}

function assertWithinActionLimit(actionCount: number, maximum: number): void {
  if (actionCount >= maximum) {
    throw new WebpageAgentError('The task exceeded its action limit.', 'ACTION_LIMIT_EXCEEDED');
  }
}

function toTaskFailure(
  result: ActionResult,
  actions: readonly ActionResult[],
  taskId: string,
): TaskResult | undefined {
  if (result.status === 'succeeded') return undefined;
  if (result.status === 'denied') return { actions, error: result.error, status: 'denied', taskId };
  if (result.status === 'cancelled')
    return { actions, error: result.error, status: 'cancelled', taskId };
  return { actions, error: result.error, status: 'failed', taskId };
}

async function authorize(
  proposal: ActionProposal,
  context: Parameters<Policy['evaluate']>[1],
  policy: Policy,
  approval: ApprovalHandler | undefined,
  emit: (event: Omit<ExecutionEvent, 'timestamp'>) => Promise<void>,
): Promise<'allowed' | 'denied'> {
  const decision = await policy.evaluate(proposal, context);
  if (decision.decision === 'deny') {
    await emit({ actionId: proposal.id, data: { reason: decision.reason }, type: 'action.denied' });
    return 'denied';
  }
  if (decision.decision === 'allow') return 'allowed';

  await emit({
    actionId: proposal.id,
    data: { reason: decision.reason },
    type: 'approval.requested',
  });
  if (!approval)
    throw new WebpageAgentError(
      'Approval is required but no handler is configured.',
      'APPROVAL_UNAVAILABLE',
    );
  const result = await approval.request(proposal, context, decision.reason);
  if (result === 'approved') return 'allowed';
  await emit({
    actionId: proposal.id,
    data: { reason: 'Approval denied.' },
    type: 'action.denied',
  });
  return 'denied';
}

function mergeSignals(
  internal: AbortSignal,
  external?: AbortSignal,
  timeoutMs?: number,
): AbortSignal {
  const signals = [internal, external].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  if (timeoutMs !== undefined) signals.push(AbortSignal.timeout(timeoutMs));
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}
