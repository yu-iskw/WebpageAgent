import { resolveElement } from './locator.js';

import type { ActionProposal, ExecutionOutput, Executor } from '@webpage-agent/core';

export class DomExecutor implements Executor {
  readonly #document: Document;

  constructor(documentValue: Document = globalThis.document) {
    this.#document = documentValue;
  }

  async execute(
    proposal: ActionProposal,
    options?: { signal?: AbortSignal },
  ): Promise<ExecutionOutput> {
    options?.signal?.throwIfAborted();
    await Promise.resolve();
    if (!proposal.target) throw new Error(`The ${proposal.kind} action requires a target.`);
    const target = resolveElement(this.#document, proposal.target.locator);
    const output = executeAction(target, proposal);
    return {
      evidence: [
        {
          detail: { kind: proposal.kind, tagName: target.tagName },
          kind: 'dom-action',
          timestamp: new Date().toISOString(),
        },
      ],
      output,
    };
  }
}

function executeAction(target: Element, proposal: ActionProposal): unknown {
  switch (proposal.kind) {
    case 'activate':
    case 'dismiss':
    case 'navigate':
      assertHTMLElement(target).click();
      return undefined;
    case 'clear-value':
      return setValue(target, '');
    case 'extract':
    case 'read':
      return readValue(target);
    case 'focus':
      assertHTMLElement(target).focus();
      return undefined;
    case 'scroll-into-view':
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      return undefined;
    case 'select-option':
      return selectOption(target, proposal.input);
    case 'set-value':
      return setValue(target, proposal.input);
    case 'submit':
      submit(target);
      return undefined;
    case 'toggle':
      assertHTMLElement(target).click();
      return readValue(target);
  }
}

function setValue(target: Element, input: unknown): string {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    throw new TypeError('set-value requires an input or textarea target.');
  }
  if (target.type === 'password' && typeof input !== 'string')
    throw new TypeError('The input must be a string.');
  const value = normalizeInput(input);
  target.value = value;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return value;
}

function selectOption(target: Element, input: unknown): string {
  if (!(target instanceof HTMLSelectElement))
    throw new TypeError('select-option requires a select target.');
  const value = normalizeInput(input);
  const matching = [...target.options].find(
    (option) => option.value === value || option.label === value || option.text === value,
  );
  if (!matching) throw new Error(`No option matches ${value}.`);
  target.value = matching.value;
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return matching.value;
}

function submit(target: Element): void {
  const form = target instanceof HTMLFormElement ? target : target.closest('form');
  if (!form) throw new Error('No form is associated with the submit target.');
  form.requestSubmit();
}

function readValue(target: Element): unknown {
  if (target instanceof HTMLInputElement) {
    if (target.type === 'password') return '[REDACTED]';
    if (['checkbox', 'radio'].includes(target.type)) return target.checked;
    return target.value;
  }
  if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)
    return target.value;
  return target.textContent.trim();
}

function assertHTMLElement(target: Element): HTMLElement {
  if (!(target instanceof HTMLElement)) throw new TypeError('The target is not an HTML element.');
  return target;
}

function normalizeInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
    return String(input);
  }
  throw new TypeError('Action input must be a string, number, boolean, null, or undefined.');
}
