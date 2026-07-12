import { describe, expect, it, vi } from 'vitest';

import { createWebpageAgent } from './index.js';

import type {
  ActionProposal,
  ActionResolver,
  ExecutionEvent,
  Observer,
  PageObservation,
  Policy,
} from './index.js';

const observation: PageObservation = {
  capturedAt: '2026-07-12T00:00:00.000Z',
  nodes: [
    {
      actions: ['activate'],
      confidence: 1,
      id: 'save',
      locator: { accessibleName: 'Save', role: 'button' },
      name: 'Save',
      provenance: { source: 'dom' },
      role: 'button',
      state: { enabled: true, visible: true },
    },
  ],
  origin: 'https://example.test',
  version: 'v1',
};

const proposal: ActionProposal = {
  confidence: 0.99,
  expectedEffects: [{ kind: 'visibility' }],
  id: 'action-1',
  kind: 'activate',
  observationVersion: 'v1',
  provenance: { resolver: 'test' },
  risk: { effects: ['remote-mutation'], level: 'medium' },
  target: { locator: { accessibleName: 'Save', role: 'button' }, nodeId: 'save' },
};

const observer: Observer = { observe: vi.fn(() => Promise.resolve(observation)) };

function createTestAgent(overrides: { policy?: Policy; resolver?: ActionResolver } = {}) {
  return createWebpageAgent({
    clock: () => new Date('2026-07-12T00:00:00.000Z'),
    executor: {
      execute: vi.fn(() =>
        Promise.resolve({
          evidence: [{ kind: 'click', timestamp: '2026-07-12T00:00:00.000Z' }],
          output: 'saved',
        }),
      ),
    },
    idFactory: () => 'task-1',
    observer,
    policy: overrides.policy,
    resolver: overrides.resolver ?? {
      name: 'test',
      resolve: vi.fn(() => Promise.resolve(proposal)),
    },
  });
}

describe('createWebpageAgent', () => {
  it('runs one verified action by default', async () => {
    const result = await createTestAgent().run('Save the form');

    expect(result.status).toBe('succeeded');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.status).toBe('succeeded');
    expect(result.actions[0]?.output).toBe('saved');
  });

  it('denies an action whose effect violates intent constraints', async () => {
    const agent = createTestAgent();
    const result = await agent.step({
      constraints: { allowedEffects: ['read-only'] },
      id: 'constrained-task',
      source: 'agent',
      text: 'Save',
    });

    expect(result.status).toBe('denied');
    expect(result.events.some((event) => event.type === 'action.denied')).toBe(true);
  });

  it('requires a configured approval handler', async () => {
    const agent = createTestAgent({
      policy: { evaluate: vi.fn(() => Promise.resolve({ decision: 'require-approval' as const })) },
    });
    const result = await agent.step('Save');

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('APPROVAL_UNAVAILABLE');
  });

  it('rejects stale proposals before execution', async () => {
    const agent = createTestAgent();
    const result = await agent.execute({ ...proposal, observationVersion: 'old' });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('INVALID_PROPOSAL');
  });

  it('stops bounded execution only when the resolver reports completion', async () => {
    let calls = 0;
    const resolver: ActionResolver = {
      name: 'bounded-test',
      resolve() {
        calls += 1;
        return Promise.resolve(calls === 1 ? proposal : { completed: true as const });
      },
    };
    const result = await createTestAgent({ resolver }).run('Save', { mode: 'bounded' });

    expect(result.status).toBe('succeeded');
    expect(result.actions).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('emits stable lifecycle events', async () => {
    const agent = createTestAgent();
    const events: ExecutionEvent[] = [];
    agent.onEvent((event) => {
      events.push(event);
    });
    await agent.run('Save');

    expect(events.map((event) => event.type)).toEqual([
      'task.started',
      'observation.completed',
      'action.proposed',
      'observation.completed',
      'action.executing',
      'action.executed',
      'action.verified',
      'task.completed',
    ]);
  });
});
