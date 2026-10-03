/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { UniverseBrowser } from '../../components/UniverseBrowser.js'
import { UniverseNamesProvider } from '../../components/UniverseNames.js'
import { UniverseSwitcher } from '../../components/UniverseSwitcher.js'
import type { ZoltarUniverseSummary } from '../../types/contracts.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { fireEvent, within } from '../testUtils/queries.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { installTestRouting } from '../testUtils/testRouting.js'
import { createUniverseSummary } from '../testUtils/universeFixtures.js'

const yesUniverseId = 11n
const alphaUniverseId = 21n
const betaUniverseId = 22n

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return createUniverseSummary({
		childUniverses: [
			{ exists: true, forkTime: 0n, outcomeIndex: 1n, outcomeLabel: 'Alpha', parentUniverseId: yesUniverseId, reputationToken: zeroAddress, reputationTokenSymbol: 'REPa', universeId: alphaUniverseId },
			{ exists: false, forkTime: 0n, outcomeIndex: 2n, outcomeLabel: 'Beta', parentUniverseId: yesUniverseId, reputationToken: zeroAddress, universeId: betaUniverseId },
		],
		forkTime: 1n,
		forkingOutcomeIndex: 1n,
		hasForked: true,
		lineage: [
			{ outcomeLabel: undefined, universeId: 0n },
			{ outcomeLabel: 'Yes', universeId: yesUniverseId },
		],
		reputationTokenName: 'Fork YES Reputation',
		reputationTokenSymbol: 'YESREP',
		totalTheoreticalSupplyAttoRep: 10n ** 18n,
		universeId: yesUniverseId,
		...overrides,
	})
}

installTestRouting()
describe('UniverseBrowser', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('shows the lineage trail, fork status, and child universes with their deployment state', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseBrowser activeUniverseId={yesUniverseId} universe={createUniverse()} actions={<button type='button'>Migrate REP</button>} />)).cleanup
		const queries = within(document.body)
		const trail = document.body.querySelector('nav[aria-label="Universe lineage"]')
		if (!(trail instanceof HTMLElement)) throw new Error('Expected the lineage trail')
		expect(within(trail).getByRole('link', { name: 'Genesis' })).toBeTruthy()
		expect(trail.querySelector('[aria-current]')?.textContent).toBe('Yes')
		expect(queries.getByRole('heading', { name: 'Yes' })).toBeTruthy()
		expect(queries.getByText('Forked', { selector: '.badge' })).toBeTruthy()
		expect(queries.getByRole('button', { name: 'Migrate REP' })).toBeTruthy()
		expect(queries.getByText('Deployed')).toBeTruthy()
		expect(queries.getByText('Not deployed')).toBeTruthy()
		expect(queries.getAllByRole('link', { name: 'Open' })).toHaveLength(1)
	})

	test('shows universe and child details without disclosure controls', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseBrowser activeUniverseId={yesUniverseId} universe={createUniverse()} />)).cleanup
		const field = within(document.body).getByText('REP supply').parentElement
		expect(field?.textContent).toContain('YESREP')
		expect(field?.closest('details')).toBeNull()
		expect(document.body.querySelector('.universe-browser details')).toBeNull()
		expect(within(document.body).getByText('REPa')).toBeTruthy()
	})

	test('explains that an unforked universe has no children yet and hides the trail at Genesis', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseBrowser activeUniverseId={0n} universe={createUniverse({ childUniverses: [], hasForked: false, lineage: [{ outcomeLabel: undefined, universeId: 0n }], universeId: 0n })} />)).cleanup
		const queries = within(document.body)
		expect(document.body.querySelector('nav[aria-label="Universe lineage"]')).toBeNull()
		expect(queries.getByRole('heading', { name: 'Genesis' })).toBeTruthy()
		expect(queries.getByText('Child universes appear after this universe forks.')).toBeTruthy()
	})
})

describe('bounded universe overview', () => {
	installDomTestLifecycle()

	test('offers parent traversal without arbitrary universe ID entry', async () => {
		const rendered = await renderIntoDocument(<UniverseBrowser activeUniverseId={yesUniverseId} universe={createUniverse({ childUniverses: [], lineage: undefined, outcomeLabel: 'Alpha', relatedUniversesLoaded: false })} />)
		try {
			const queries = within(document.body)
			expect(queries.getByRole('heading', { name: 'Alpha' })).toBeTruthy()
			expect(queries.queryByText('Child universes')).toBeNull()
			expect(queries.queryByText('No deployed child universes.')).toBeNull()
			expect(
				within(queries.getByText('Parent universe').parentElement ?? document.body)
					.getByRole('link')
					.getAttribute('href'),
			).toContain('universe=0')
			expect(document.body.querySelector('.universe-browser details')).toBeNull()
			expect(queries.queryByRole('textbox')).toBeNull()
			expect(queries.getAllByText('Parent universe')).toHaveLength(1)
			expect(document.body.querySelector('.universe-browser .button-link')).toBeNull()
			await act(() =>
				within(queries.getByText('Parent universe').parentElement ?? document.body)
					.getByRole('link')
					.click(),
			)
			expect(window.location.hash).toContain('universe=0')
		} finally {
			await rendered.cleanup()
		}
	})

	test('the bounded header traverses only to the immediate parent', async () => {
		const rendered = await renderIntoDocument(<UniverseSwitcher activeUniverseId={alphaUniverseId} universe={createUniverse({ universeId: alphaUniverseId, parentUniverseId: yesUniverseId, lineage: undefined, relatedUniversesLoaded: false })} />)
		try {
			const queries = within(document.body)
			expect(queries.getByRole('link', { name: 'Parent universe' }).getAttribute('href')).toContain('universe=11')
			expect(queries.queryByRole('link', { name: 'Genesis' })).toBeNull()
		} finally {
			await rendered.cleanup()
		}
	})

	test('summary scope ignores cached ancestry and children and keeps header and parent names stable', async () => {
		const full = createUniverse({
			universeId: alphaUniverseId,
			parentUniverseId: yesUniverseId,
			outcomeLabel: undefined,
			relatedUniversesLoaded: true,
			lineage: [
				{ universeId: 0n, outcomeLabel: undefined },
				{ universeId: yesUniverseId, outcomeLabel: 'Yes' },
				{ universeId: alphaUniverseId, outcomeLabel: 'Alpha' },
			],
		})
		const tree = (universe: ZoltarUniverseSummary) => (
			<UniverseNamesProvider includeRelatedUniverses={false} universe={universe}>
				<UniverseBrowser activeUniverseId={alphaUniverseId} includeRelatedUniverses={false} universe={universe} />
				<UniverseSwitcher activeUniverseId={alphaUniverseId} includeRelatedUniverses={false} universe={universe} />
			</UniverseNamesProvider>
		)
		const rendered = await renderIntoDocument(tree(full))
		try {
			expect(document.querySelector('.universe-switcher-label')?.textContent).toBe('Alpha')
			expect(document.querySelector('.decision-heading h3')?.textContent).toBe('Alpha')
			expect(document.querySelector('.universe-lineage')).toBeNull()
			expect(within(document.body).queryByText('Child universes')).toBeNull()
			expect(within(document.body).queryByText('Genesis › Yes')).toBeNull()
			const content = rendered.container.textContent
			await act(() => render(tree({ ...full, outcomeLabel: 'Alpha', childUniverses: [], lineage: undefined, relatedUniversesLoaded: false }), rendered.container))
			expect(rendered.container.textContent).toBe(content)
		} finally {
			await rendered.cleanup()
		}
	})

	test('full lineage names earlier ancestors without offering jumps over the parent', async () => {
		const universe = createUniverse({
			universeId: alphaUniverseId,
			parentUniverseId: yesUniverseId,
			lineage: [
				{ outcomeLabel: undefined, universeId: 0n },
				{ outcomeLabel: 'Yes', universeId: yesUniverseId },
				{ outcomeLabel: 'Alpha', universeId: alphaUniverseId },
			],
		})
		const rendered = await renderIntoDocument(
			<>
				<UniverseBrowser activeUniverseId={alphaUniverseId} universe={universe} />
				<UniverseSwitcher activeUniverseId={alphaUniverseId} universe={universe} />
			</>,
		)
		try {
			const queries = within(document.body)
			expect(queries.queryByRole('link', { name: 'Genesis' })).toBeNull()
			expect(queries.getByRole('link', { name: 'Genesis › Yes' }).getAttribute('href')).toContain('universe=11')
			expect(queries.getByRole('link', { name: 'Yes' }).getAttribute('href')).toContain('universe=11')
		} finally {
			await rendered.cleanup()
		}
	})

	test('does not label omitted child information as an empty tree in the header', async () => {
		const rendered = await renderIntoDocument(<UniverseSwitcher activeUniverseId={yesUniverseId} universe={createUniverse({ relatedUniversesLoaded: false })} />)
		try {
			expect(within(document.body).queryByText('Child universes')).toBeNull()
			expect(within(document.body).queryByText('No deployed child universes.')).toBeNull()
		} finally {
			await rendered.cleanup()
		}
	})
})

describe('UniverseSwitcher', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('names the active universe by lineage and offers its parent, deployed children, and the browser', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseSwitcher activeUniverseId={yesUniverseId} browseHref='#/zoltar?zoltarView=universes' universe={createUniverse()} />)).cleanup
		const details = document.body.querySelector('details.universe-switcher')
		if (!(details instanceof HTMLElement)) throw new Error('Expected the switcher disclosure')
		const summary = details.querySelector('summary')
		expect(summary?.getAttribute('aria-label')).toBe('Universe: Genesis › Yes. Switch universe')
		const queries = within(details)
		expect(queries.getByRole('link', { name: 'Genesis' })).toBeTruthy()
		expect(queries.getByRole('link', { name: 'Alpha' })).toBeTruthy()
		expect(queries.queryByRole('link', { name: 'Beta' })).toBeNull()
		expect(queries.getByRole('link', { name: 'Browse universes' }).getAttribute('href')).toBe('#/zoltar?zoltarView=universes')

		details.setAttribute('open', '')
		fireEvent.click(queries.getByRole('link', { name: 'Alpha' }))
		expect(details.hasAttribute('open')).toBe(false)
		for (const navigationEvent of ['hashchange', 'popstate']) {
			details.setAttribute('open', '')
			window.dispatchEvent(new Event(navigationEvent))
			expect(details.hasAttribute('open')).toBe(false)
		}
	})

	test('keeps the menu within the viewport and flips above a low trigger', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseSwitcher activeUniverseId={yesUniverseId} universe={createUniverse()} />)).cleanup
		const details = document.querySelector('details.universe-switcher')
		const summary = details?.querySelector('summary')
		const popover = details?.querySelector('.universe-switcher-popover')
		if (!(details instanceof HTMLElement) || !(summary instanceof HTMLElement) || !(popover instanceof HTMLElement)) throw new Error('Expected the switcher and its menu')
		Object.defineProperty(popover, 'scrollHeight', { value: 300 })
		let triggerTop = 80
		let triggerLeft = 0
		summary.getBoundingClientRect = () => new window.DOMRect(triggerLeft, triggerTop, 100, 32)
		popover.getBoundingClientRect = () => new window.DOMRect(0, 0, 240, 300)
		details.setAttribute('open', '')
		await act(async () => details.dispatchEvent(new Event('toggle')))
		expect(popover.style.left).toBe('12px')
		expect(popover.style.top).toBe('120px')
		expect(Number.parseFloat(popover.style.maxHeight)).toBeLessThanOrEqual(window.innerHeight - 132)
		triggerLeft = window.innerWidth - 40
		window.dispatchEvent(new Event('resize'))
		expect(Number.parseFloat(popover.style.left) + 240).toBe(window.innerWidth - 12)
		triggerTop = window.innerHeight - 60
		window.dispatchEvent(new Event('resize'))
		expect(Number.parseFloat(popover.style.top)).toBe(triggerTop - 308)
		window.dispatchEvent(new Event('scroll'))
		expect(Number.parseFloat(popover.style.top)).toBe(triggerTop - 308)
		Object.defineProperty(window, 'visualViewport', { configurable: true, value: { width: 195, height: 422, offsetLeft: 0, offsetTop: 0 } })
		window.dispatchEvent(new Event('resize'))
		expect(popover.style.minWidth).toBe('min(16rem, 171px)')
		expect(popover.style.maxWidth).toBe('171px')
	})

	test('omits the child section for a universe that has not forked', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseSwitcher activeUniverseId={yesUniverseId} universe={createUniverse({ childUniverses: [], hasForked: false })} />)).cleanup
		expect(within(document.body).queryByText('Child universes')).toBeNull()
		expect(within(document.body).queryByText('No deployed child universes.')).toBeNull()
	})

	test('falls back to a short id until the active universe summary loads', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseSwitcher activeUniverseId={alphaUniverseId} universe={createUniverse()} />)).cleanup
		const summary = document.body.querySelector('details.universe-switcher summary')
		expect(summary?.getAttribute('title')).toBe('Universe 0x15')
		expect(within(document.body).queryByRole('link', { name: 'Browse universes' })).toBeNull()
	})
})

describe('UniverseNamesProvider', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('names universe links inside the provider by lineage', async () => {
		cleanupRenderedComponent = (
			await renderIntoDocument(
				<UniverseNamesProvider universe={createUniverse()}>
					<UniverseBrowser activeUniverseId={alphaUniverseId} universe={createUniverse({ childUniverses: [], hasForked: false, lineage: [...(createUniverse().lineage ?? []), { outcomeLabel: 'Alpha', universeId: alphaUniverseId }], parentUniverseId: yesUniverseId, universeId: alphaUniverseId })} />
				</UniverseNamesProvider>,
			)
		).cleanup
		const parentField = within(document.body).getByText('Parent universe').parentElement
		expect(parentField?.querySelector('a')?.textContent).toBe('Genesis › Yes')
	})
})
