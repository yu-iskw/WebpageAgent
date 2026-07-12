import { describe, expect, it } from 'vitest';

import { DefaultProposalValidator, evidenceVerifier } from './defaults.js';
import { serializeError, WebpageAgentError } from './errors.js';

import type { ActionProposal, PageObservation } from './types.js';

const observation: PageObservation = {
  capturedAt: '2026-07-12T00:00:00.000Z',
  nodes: [],
  origin: 'https://example.test',
  version: 'current',
};

const proposal: ActionProposal = {
  confidence: 1,
  expectedEffects: [],
  id: 'a1',
  kind: 'read',
  observationVersion: 'old',
  provenance: { resolver: 'test' },
  risk: { effects: ['read-only'], level: 'low' },
};

describe('DefaultProposalValidator', () => {
  it('rejects observations with a different version', async () => {
    const result = await new DefaultProposalValidator().validate(proposal, observation);

    expect(result).toEqual({
      valid: false,
      reason: 'The proposal was resolved against stale page state.',
    });
  });

  it('accepts a targetless proposal resolved from current state', async () => {
    const result = await new DefaultProposalValidator().validate(
      { ...proposal, observationVersion: 'current' },
      observation,
    );

    expect(result).toEqual({ valid: true });
  });

  it('delegates locator-only target resolution to an executor adapter', async () => {
    const result = await new DefaultProposalValidator().validate(
      {
        ...proposal,
        observationVersion: 'current',
        target: { locator: { testId: 'save' } },
      },
      observation,
    );

    expect(result).toEqual({ valid: true });
  });
});

describe('evidenceVerifier', () => {
  it('distinguishes execution evidence from declared outcome verification', async () => {
    const withEvidence = await evidenceVerifier.verify(proposal, {
      evidence: [{ kind: 'click', timestamp: '2026-07-12T00:00:00.000Z' }],
    });
    const withoutEvidence = await evidenceVerifier.verify(proposal, { evidence: [] });

    expect(withEvidence).toMatchObject({ confidence: 0.8, success: false });
    expect(withoutEvidence).toMatchObject({ confidence: 0, success: false });
  });
});

describe('serializeError', () => {
  it('preserves domain codes and safely normalizes unknown failures', () => {
    expect(serializeError(new WebpageAgentError('stale', 'STALE'))).toEqual({
      code: 'STALE',
      message: 'stale',
      name: 'WebpageAgentError',
    });
    expect(serializeError(new TypeError('invalid'))).toEqual({
      message: 'invalid',
      name: 'TypeError',
    });
    expect(serializeError('failure')).toEqual({ message: 'failure', name: 'Error' });
  });
});
