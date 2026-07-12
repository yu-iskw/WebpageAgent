import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';
import type { ActionProposal, PageObservation, StableLocator } from '@webpage-agent/core';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('observes accessible controls and redacts password values', async ({ page }) => {
  await resetFixture(
    page,
    `
      <label for="email">Email address</label>
      <input id="email" data-testid="email" value="person@example.test">
      <input aria-label="Password" type="password" value="secret">
      <button aria-label="Save">Ignored text</button>
      <button hidden>Hidden</button>
    `,
  );

  const observation = await observe(page);

  expect(observation.origin).toBe('http://127.0.0.1:4173');
  expect(observation.nodes).toHaveLength(3);
  expect(observation.nodes.find((node) => node.name === 'Email address')?.value).toBe(
    'person@example.test',
  );
  expect(observation.nodes.find((node) => node.name === 'Password')?.value).toBe('[REDACTED]');
  expect(observation.nodes.find((node) => node.name === 'Save')?.actions).toContain('activate');
});

test('fails closed when semantic targets are ambiguous or hidden', async ({ page }) => {
  await resetFixture(page, '<button>Save</button><button>Save</button>');
  const ambiguous = await resolveFailure(page, { accessibleName: 'Save', role: 'button' });
  expect(ambiguous).toContain('equally likely targets');

  await resetFixture(page, '<button hidden>Save</button>');
  const hidden = await resolveFailure(page, { accessibleName: 'Save', role: 'button' });
  expect(hidden).toContain('No visible target matches');
});

test('uses stable test-id evidence to disambiguate duplicate names', async ({ page }) => {
  await resetFixture(
    page,
    '<button data-testid="primary-save">Save</button><button data-testid="secondary-save">Save</button>',
  );

  const resolved = await page.evaluate(() =>
    window.webpageAgentFixture.resolve({
      accessibleName: 'Save',
      role: 'button',
      testId: 'primary-save',
    }),
  );

  expect(resolved).toBe('primary-save');
});

test('sets and clears values while dispatching browser events', async ({ page }) => {
  await resetFixture(page, '<input data-testid="name" value="before">');
  await page.evaluate(() => {
    const input = document.querySelector('[data-testid="name"]');
    input?.addEventListener('input', () => input.setAttribute('data-input-fired', 'true'));
    input?.addEventListener('change', () => input.setAttribute('data-change-fired', 'true'));
  });

  const setResult = await execute(page, proposal('set-value', 'Ada'));
  expect(setResult.output).toBe('Ada');
  await expect(page.getByTestId('name')).toHaveValue('Ada');
  await expect(page.getByTestId('name')).toHaveAttribute('data-input-fired', 'true');
  await expect(page.getByTestId('name')).toHaveAttribute('data-change-fired', 'true');

  await execute(page, proposal('clear-value'));
  await expect(page.getByTestId('name')).toHaveValue('');
});

test('selects options, toggles controls, and focuses targets', async ({ page }) => {
  await resetFixture(
    page,
    `
      <select data-testid="choice">
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </select>
      <input data-testid="enabled" type="checkbox">
    `,
  );

  const selected = await execute(page, proposal('select-option', 'Beta', 'choice'));
  expect(selected.output).toBe('b');
  await expect(page.getByTestId('choice')).toHaveValue('b');

  const toggled = await execute(page, proposal('toggle', undefined, 'enabled'));
  expect(toggled.output).toBe(true);
  await expect(page.getByTestId('enabled')).toBeChecked();

  await execute(page, proposal('focus', undefined, 'enabled'));
  await expect(page.getByTestId('enabled')).toBeFocused();
});

test('activates controls in a real browser event loop', async ({ page }) => {
  await resetFixture(
    page,
    '<button data-testid="save">Save</button><output data-testid="result"></output>',
  );
  await page.getByTestId('save').evaluate((button) => {
    button.addEventListener('click', () => {
      const output = document.querySelector('[data-testid="result"]');
      if (output) output.textContent = 'saved';
    });
  });

  await execute(page, proposal('activate', undefined, 'save'));

  await expect(page.getByTestId('result')).toHaveText('saved');
});

test('captures asynchronous page changes as a new observation version', async ({ page }) => {
  await resetFixture(page, '<button data-testid="save">Save</button>');
  const before = await observe(page);

  await page.evaluate(() => {
    setTimeout(() => {
      const button = document.querySelector('[data-testid="save"]');
      if (button) button.setAttribute('aria-label', 'Save changes');
    }, 10);
  });
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  const after = await observe(page);

  expect(after.version).not.toBe(before.version);
});

test('observes and executes controls in open shadow roots', async ({ page }) => {
  await resetFixture(page, '<div data-testid="shadow-host"></div>');
  await page.getByTestId('shadow-host').evaluate((host) => {
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button data-testid="shadow-action">Shadow action</button>';
    root.querySelector('button')?.addEventListener('click', (event) => {
      (event.currentTarget as Element).setAttribute('data-clicked', 'true');
    });
  });

  const observation = await observe(page);
  await execute(page, proposal('activate', undefined, 'shadow-action'));

  expect(observation.nodes.some((node) => node.name === 'Shadow action')).toBe(true);
  await expect(page.getByTestId('shadow-host').locator('button')).toHaveAttribute(
    'data-clicked',
    'true',
  );
});

function proposal(kind: ActionProposal['kind'], input?: unknown, testId = 'name'): ActionProposal {
  return {
    confidence: 1,
    expectedEffects: [{ kind: 'state-change' }],
    id: 'action',
    input,
    kind,
    observationVersion: 'fixture',
    provenance: { resolver: 'playwright-fixture' },
    risk: { effects: ['local-mutation'], level: 'low' },
    target: { locator: { testId }, nodeId: testId },
  };
}

async function resetFixture(page: Page, markup: string): Promise<void> {
  await page.evaluate((value) => window.webpageAgentFixture.reset(value), markup);
}

async function observe(page: Page): Promise<PageObservation> {
  return page.evaluate(() => window.webpageAgentFixture.observe());
}

async function execute(
  page: Page,
  action: ActionProposal,
): Promise<{ evidence: readonly unknown[]; output?: unknown }> {
  return page.evaluate((value) => window.webpageAgentFixture.execute(value), action) as Promise<{
    evidence: readonly unknown[];
    output?: unknown;
  }>;
}

async function resolveFailure(page: Page, locator: StableLocator): Promise<string> {
  return page.evaluate((value) => {
    try {
      window.webpageAgentFixture.resolve(value);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, locator);
}
