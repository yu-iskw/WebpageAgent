import type { SemanticActionKind, StableLocator } from '@webpage-agent/core';

const ROLE_BY_TAG: Readonly<Record<string, string>> = {
  A: 'link',
  BUTTON: 'button',
  FORM: 'form',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  IMG: 'img',
  NAV: 'navigation',
  SELECT: 'combobox',
  TEXTAREA: 'textbox',
};

export function getRole(element: Element): string | undefined {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;
  if (element.tagName === 'INPUT') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (['button', 'reset', 'submit'].includes(type)) return 'button';
    if (type === 'range') return 'slider';
    return 'textbox';
  }
  return ROLE_BY_TAG[element.tagName];
}

export function getAccessibleName(element: Element): string | undefined {
  const ariaLabel = normalize(element.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = normalize(
      labelledBy
        .split(/\s+/)
        .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
        .join(' '),
    );
    if (text) return text;
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const label = normalize(element.labels?.[0]?.textContent);
    if (label) return label;
    const placeholder = normalize(element.getAttribute('placeholder'));
    if (placeholder) return placeholder;
  }
  if (element instanceof HTMLImageElement) return normalize(element.alt);
  return normalize(element.textContent);
}

export function getActions(element: Element): readonly SemanticActionKind[] {
  if (element instanceof HTMLInputElement) {
    if (['checkbox', 'radio'].includes(element.type)) return ['activate', 'focus', 'toggle'];
    if (['button', 'reset', 'submit'].includes(element.type))
      return ['activate', 'focus', 'submit'];
    return ['clear-value', 'focus', 'read', 'set-value'];
  }
  if (element instanceof HTMLTextAreaElement) return ['clear-value', 'focus', 'read', 'set-value'];
  if (element instanceof HTMLSelectElement) return ['focus', 'read', 'select-option'];
  if (element instanceof HTMLFormElement) return ['submit'];
  if (element instanceof HTMLAnchorElement) return ['activate', 'focus', 'navigate'];
  if (element instanceof HTMLButtonElement || element.getAttribute('role') === 'button') {
    return ['activate', 'focus'];
  }
  return ['read', 'scroll-into-view'];
}

export function createLocator(element: Element, role?: string, name?: string): StableLocator {
  const testId = element.getAttribute('data-testid') ?? undefined;
  const id = element.id || undefined;
  return {
    accessibleName: name,
    attributes: id ? { id } : undefined,
    fallbackCss: createCssFallback(element),
    label: getFormLabel(element),
    role,
    structuralPath: createStructuralPath(element),
    testId,
  };
}

export function isVisible(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

function createCssFallback(element: Element): string {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const testId = element.getAttribute('data-testid');
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && parts.length < 4) {
    const currentElement = current;
    const siblings = current.parentElement ? [...current.parentElement.children] : [];
    const sameTag = siblings.filter((sibling) => sibling.tagName === currentElement.tagName);
    const suffix = sameTag.length > 1 ? `:nth-of-type(${sameTag.indexOf(currentElement) + 1})` : '';
    parts.unshift(`${current.tagName.toLowerCase()}${suffix}`);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function createStructuralPath(element: Element): readonly string[] {
  const path: string[] = [];
  let current: Element | null = element.parentElement;
  while (current && path.length < 3) {
    const name = getAccessibleName(current);
    const role = getRole(current);
    if (name || role) path.unshift([role, name].filter(Boolean).join(':'));
    current = current.parentElement;
  }
  return path;
}

function getFormLabel(element: Element): string | undefined {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return normalize(element.labels?.[0]?.textContent);
  }
  return undefined;
}

function normalize(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}
