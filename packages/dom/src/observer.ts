import { createLocator, getAccessibleName, getActions, getRole, isVisible } from './semantics.js';

import type { Observer, PageObservation, SemanticNode } from '@webpage-agent/core';

const CANDIDATE_SELECTOR = [
  'a[href]',
  'button',
  'form',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role]',
  '[tabindex]',
].join(',');

export interface DomObserverOptions {
  document?: Document;
  includeHidden?: boolean;
  maxNodes?: number;
}

export class DomObserver implements Observer {
  readonly #document: Document;
  readonly #includeHidden: boolean;
  readonly #maxNodes: number;

  constructor(options: DomObserverOptions = {}) {
    const documentValue = options.document ?? globalThis.document;
    this.#document = documentValue;
    this.#includeHidden = options.includeHidden ?? false;
    this.#maxNodes = options.maxNodes ?? 500;
  }

  observe(options?: { signal?: AbortSignal }): Promise<PageObservation> {
    options?.signal?.throwIfAborted();
    const elements = [...this.#document.querySelectorAll(CANDIDATE_SELECTOR)].slice(
      0,
      this.#maxNodes,
    );
    const nodes = elements
      .map((element, index) => this.#toSemanticNode(element, index))
      .filter((node): node is SemanticNode => node !== undefined);
    const origin = this.#document.location.origin;
    const capturedAt = new Date().toISOString();
    return Promise.resolve({
      capturedAt,
      nodes,
      origin,
      title: this.#document.title,
      version: fingerprint(
        `${origin}\n${this.#document.location.pathname}\n${JSON.stringify(nodes)}`,
      ),
    });
  }

  #toSemanticNode(element: Element, index: number): SemanticNode | undefined {
    const visible = isVisible(element);
    if (!visible && !this.#includeHidden) return undefined;
    const role = getRole(element);
    const name = getAccessibleName(element);
    const value = readValue(element);
    return {
      actions: getActions(element),
      confidence: role && name ? 1 : role || name ? 0.8 : 0.6,
      id: fingerprint(`${index}:${role ?? ''}:${name ?? ''}:${element.tagName}`),
      locator: createLocator(element, role, name),
      name,
      provenance: { source: 'dom' },
      role,
      state: {
        checked: readBooleanProperty(element, 'checked'),
        enabled: !readBooleanProperty(element, 'disabled'),
        expanded: parseAriaBoolean(element.getAttribute('aria-expanded')),
        readonly: readBooleanProperty(element, 'readOnly'),
        required: readBooleanProperty(element, 'required'),
        selected: readBooleanProperty(element, 'selected'),
        visible,
      },
      value,
    };
  }
}

function readValue(element: Element): unknown {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return element.type === 'password' ? '[REDACTED]' : element.value;
  }
  return undefined;
}

function readBooleanProperty(element: Element, property: string): boolean | undefined {
  const value = Reflect.get(element, property) as unknown;
  return typeof value === 'boolean' ? value : undefined;
}

function parseAriaBoolean(value: string | null): boolean | undefined {
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

export function fingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `dom-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
