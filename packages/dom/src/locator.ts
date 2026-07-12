import { getAccessibleName, getRole, isVisible } from './semantics.js';
import { querySelectorAllDeep } from './traversal.js';

import type { StableLocator } from '@webpage-agent/core';

export class AmbiguousTargetError extends Error {
  constructor(readonly count: number) {
    super(`The locator matched ${count} equally likely targets.`);
    this.name = 'AmbiguousTargetError';
  }
}

export function resolveElement(documentValue: Document, locator: StableLocator): Element {
  const pool = collectCandidates(documentValue, locator);
  const candidates = pool
    .filter(isVisible)
    .map((element) => ({ element, score: scoreElement(element, locator) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  if (candidates.length === 0) throw new Error('No visible target matches the stable locator.');
  if (candidates[1]?.score === candidates[0]?.score) {
    throw new AmbiguousTargetError(
      candidates.filter(({ score }) => score === candidates[0]?.score).length,
    );
  }
  return candidates[0].element;
}

export function scoreElement(element: Element, locator: StableLocator): number {
  if (locator.role && getRole(element) !== locator.role) return 0;
  if (locator.accessibleName && getAccessibleName(element) !== locator.accessibleName) return 0;
  let score = 0;
  if (locator.testId && element.getAttribute('data-testid') === locator.testId) score += 100;
  if (locator.attributes?.id && element.id === locator.attributes.id) score += 90;
  if (locator.role) score += 30;
  if (locator.accessibleName) score += 40;
  if (locator.label && getAccessibleName(element) === locator.label) score += 25;
  for (const [name, value] of Object.entries(locator.attributes ?? {})) {
    if (name !== 'id' && element.getAttribute(name) === value) score += 10;
  }
  return score;
}

function collectCandidates(documentValue: Document, locator: StableLocator): Element[] {
  const selectors: string[] = [];
  if (locator.testId) selectors.push(`[data-testid="${CSS.escape(locator.testId)}"]`);
  if (locator.attributes?.id) selectors.push(`#${CSS.escape(locator.attributes.id)}`);
  if (locator.fallbackCss) selectors.push(locator.fallbackCss);
  for (const selector of selectors) {
    try {
      const matches = [...querySelectorAllDeep(documentValue, selector)];
      if (matches.length > 0) return matches;
    } catch {
      // A fallback is only a hint; malformed caller input must not prevent semantic resolution.
    }
  }
  return [...querySelectorAllDeep(documentValue, '*')];
}
