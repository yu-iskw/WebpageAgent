export function querySelectorAllDeep(
  root: Document | ShadowRoot,
  selector: string,
): readonly Element[] {
  const matches = [...root.querySelectorAll(selector)];
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) matches.push(...querySelectorAllDeep(element.shadowRoot, selector));
  }
  return matches;
}
