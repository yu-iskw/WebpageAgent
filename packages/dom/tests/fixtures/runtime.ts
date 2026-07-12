import { DomExecutor, DomObserver, resolveElement } from '../../src/index.js';

import type { ActionProposal, PageObservation, StableLocator } from '@webpage-agent/core';

declare global {
  interface Window {
    webpageAgentFixture: {
      execute(proposal: ActionProposal): Promise<unknown>;
      observe(): Promise<PageObservation>;
      resolve(locator: StableLocator): string;
      reset(markup: string): void;
    };
  }
}

const fixture = document.querySelector('#fixture');
if (!fixture) throw new Error('The fixture root is missing.');

window.webpageAgentFixture = {
  async execute(proposal) {
    return new DomExecutor(document).execute(proposal);
  },
  async observe() {
    return new DomObserver({ document }).observe();
  },
  resolve(locator) {
    return resolveElement(document, locator).getAttribute('data-testid') ?? '';
  },
  reset(markup) {
    fixture.innerHTML = markup;
  },
};
