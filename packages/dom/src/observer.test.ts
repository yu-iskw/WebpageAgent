import { beforeEach, describe, expect, it } from 'vitest';

import { DomExecutor } from './executor.js';
import { AmbiguousTargetError, resolveElement, scoreElement } from './locator.js';
import { fingerprint, DomObserver } from './observer.js';
import { createLocator, getAccessibleName, getActions, getRole, isVisible } from './semantics.js';

import type { ActionProposal } from '@webpage-agent/core';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('fingerprint', () => {
  it('is deterministic and content-sensitive', () => {
    expect(fingerprint('same')).toBe(fingerprint('same'));
    expect(fingerprint('same')).not.toBe(fingerprint('different'));
    expect(fingerprint('same')).toMatch(/^dom-[0-9a-f]{8}$/);
  });
});

describe('DomObserver', () => {
  it('creates a compact semantic observation and redacts passwords', async () => {
    document.body.innerHTML = `
      <label for="email">Email address</label>
      <input id="email" data-testid="email" value="person@example.test">
      <input aria-label="Password" type="password" value="secret">
      <button aria-label="Save">Ignored text</button>
      <button hidden>Hidden</button>
    `;

    const result = await new DomObserver({ document }).observe();

    expect(result.origin).toBe('http://localhost:3000');
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.find((node) => node.name === 'Email address')?.value).toBe(
      'person@example.test',
    );
    expect(result.nodes.find((node) => node.name === 'Password')?.value).toBe('[REDACTED]');
    expect(result.nodes.find((node) => node.name === 'Save')?.actions).toContain('activate');
  });

  it('can retain hidden nodes for diagnostics', async () => {
    document.body.innerHTML = '<button hidden>Hidden</button>';

    const result = await new DomObserver({ document, includeHidden: true }).observe();

    expect(result.nodes[0]?.state.visible).toBe(false);
  });
});

describe('semantic helpers', () => {
  it('derives native roles, names, actions, and stable locator hints', () => {
    document.body.innerHTML =
      '<label for="choice">Choice</label><select id="choice" data-testid="choice"><option>A</option></select>';
    const select = document.querySelector('select');
    if (!select) throw new Error('Fixture did not render.');

    expect(getRole(select)).toBe('combobox');
    expect(getAccessibleName(select)).toBe('Choice');
    expect(getActions(select)).toContain('select-option');
    expect(createLocator(select, 'combobox', 'Choice')).toMatchObject({
      accessibleName: 'Choice',
      label: 'Choice',
      role: 'combobox',
      testId: 'choice',
    });
    expect(isVisible(select)).toBe(true);
  });

  it('derives input roles from type', () => {
    document.body.innerHTML =
      '<input type="checkbox"><input type="radio"><input type="range"><input type="submit">';
    const inputs = [...document.querySelectorAll('input')];

    expect(inputs.map(getRole)).toEqual(['checkbox', 'radio', 'slider', 'button']);
    expect(getActions(inputs[0] as Element)).toContain('toggle');
  });
});

describe('stable locator resolution', () => {
  it('prefers strong test-id evidence', () => {
    document.body.innerHTML = '<button data-testid="save">Save</button><button>Save</button>';
    const locator = { accessibleName: 'Save', role: 'button', testId: 'save' };
    const target = resolveElement(document, locator);

    expect(target.getAttribute('data-testid')).toBe('save');
    expect(scoreElement(target, locator)).toBe(170);
  });

  it('fails closed on ambiguous semantic matches', () => {
    document.body.innerHTML = '<button>Save</button><button>Save</button>';

    expect(() => resolveElement(document, { accessibleName: 'Save', role: 'button' })).toThrow(
      AmbiguousTargetError,
    );
  });

  it('fails when no visible target matches', () => {
    document.body.innerHTML = '<button hidden>Save</button>';

    expect(() => resolveElement(document, { accessibleName: 'Save', role: 'button' })).toThrow(
      'No visible target matches',
    );
  });
});

describe('DomExecutor', () => {
  it('sets values through browser events', async () => {
    document.body.innerHTML = '<input data-testid="name">';
    const input = document.querySelector('input');
    if (!input) throw new Error('Fixture did not render.');
    const changed = new Promise<void>((resolve) =>
      input.addEventListener('change', () => resolve()),
    );

    const result = await new DomExecutor(document).execute(createProposal('set-value', 'Ada'));

    await changed;
    expect(input.value).toBe('Ada');
    expect(result.output).toBe('Ada');
    expect(result.evidence[0]?.kind).toBe('dom-action');
  });

  it('selects by option label and reads the selected value', async () => {
    document.body.innerHTML =
      '<select data-testid="name"><option value="a">Alpha</option><option value="b">Beta</option></select>';
    const executor = new DomExecutor(document);

    const selected = await executor.execute(createProposal('select-option', 'Beta'));
    const read = await executor.execute(createProposal('read'));

    expect(selected.output).toBe('b');
    expect(read.output).toBe('b');
  });

  it('activates buttons and rejects incompatible action targets', async () => {
    document.body.innerHTML = '<button data-testid="name">Save</button>';
    const button = document.querySelector('button');
    if (!button) throw new Error('Fixture did not render.');
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });

    await new DomExecutor(document).execute(createProposal('activate'));
    await expect(
      new DomExecutor(document).execute(createProposal('set-value', 'bad')),
    ).rejects.toThrow('set-value requires');
    expect(clicks).toBe(1);
  });

  it('clears, focuses, and reads text inputs', async () => {
    document.body.innerHTML = '<input data-testid="name" value="before">';
    const executor = new DomExecutor(document);

    expect((await executor.execute(createProposal('read'))).output).toBe('before');
    expect((await executor.execute(createProposal('clear-value'))).output).toBe('');
    await executor.execute(createProposal('focus'));
    expect(document.activeElement?.getAttribute('data-testid')).toBe('name');
  });

  it('toggles checkboxes and rejects invalid structured inputs', async () => {
    document.body.innerHTML = '<input data-testid="name" type="checkbox">';
    const executor = new DomExecutor(document);

    expect((await executor.execute(createProposal('toggle'))).output).toBe(true);
    await expect(executor.execute(createProposal('set-value', { secret: true }))).rejects.toThrow(
      'Action input must be',
    );
  });

  it('fails when a select option does not exist', async () => {
    document.body.innerHTML =
      '<select data-testid="name"><option value="a">Alpha</option></select>';

    await expect(
      new DomExecutor(document).execute(createProposal('select-option', 'Missing')),
    ).rejects.toThrow('No option matches');
  });
});

function createProposal(kind: ActionProposal['kind'], input?: unknown): ActionProposal {
  return {
    confidence: 1,
    expectedEffects: [{ kind: 'state-change' }],
    id: 'action',
    input,
    kind,
    observationVersion: 'fixture',
    provenance: { resolver: 'test' },
    risk: { effects: ['local-mutation'], level: 'low' },
    target: { locator: { testId: 'name' }, nodeId: 'name' },
  };
}
