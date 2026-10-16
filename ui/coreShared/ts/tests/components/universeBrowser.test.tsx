/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { OutcomeUniverseList } from '../../components/OutcomeUniverseList.js'
import { UniverseBrowser } from '../../components/UniverseBrowser.js'
import { UniverseNamesProvider } from '../../components/UniverseNames.js'
import { UniverseSwitcher } from '../../components/UniverseSwitcher.js'
import type { ZoltarUniverseSummary } from '../../types/contracts.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { fireEvent, within } from '../testUtils/queries.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { installTestRouting } from '../testUtils/testRouting.js'
import { createUniverseSummary } from '../testUtils/universeFixtures.js'
import { getGenesisNetworkProfile, SEPOLIA_NETWORK_PROFILE, setRuntimeNetworkProfile } from '../../wallet/networkProfile.js'

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

	test('allows an outcome with unknown deployment status without inventing a description', async () => {
		let selected = false
		const view = await renderIntoDocument(
			<OutcomeUniverseList
				outcomes={[
					{
						key: 'yes',
						label: 'Yes',
						onSelect: () => {
							selected = true
						},
					},
				]}
			/>,
		)
		cleanupRenderedComponent = view.cleanup
		const open = within(view.container).getByRole('button', { name: 'Open Yes universe' })
		expect(open.hasAttribute('disabled')).toBe(false)
		expect(open.hasAttribute('aria-describedby')).toBe(false)
		expect(view.container.querySelector('.badge')).toBeNull()
		expect(view.container.querySelector('.migration-outcome-metrics')).toBeNull()
		fireEvent.click(open)
		expect(selected).toBe(true)
	})

	test('shows the lineage trail, fork status, and child universes with their deployment state', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseBrowser activeUniverseId={yesUniverseId} universe={createUniverse()} actions={<button type='button'>Migrate REP</button>} />)).cleanup
		const queries = within(document.body)
		const trail = document.body.querySelector('nav[aria-label="Universe lineage"]')
		if (!(trail instanceof HTMLElement)) throw new Error('Expected the lineage trail')
		expect(within(trail).getByRole('link', { name: 'Genesis › Yes' })).toBeTruthy()
		expect(trail.querySelector('[aria-current]')?.textContent).toBe('Yes')
		expect(queries.getByRole('heading', { name: 'Yes' })).toBeTruthy()
		expect(queries.getByText('Forked', { selector: '.badge' })).toBeTruthy()
		expect(queries.getByRole('button', { name: 'Migrate REP' })).toBeTruthy()
		expect(queries.getByText('Deployed')).toBeTruthy()
		expect(queries.getByText('Not deployed')).toBeTruthy()
		expect(queries.getAllByRole('link', { name: 'Open' })).toHaveLength(1)
	})

	test('keeps normal fork ancestry without repeating the historical fork choices on descendants', async () => {
		window.history.replaceState({}, '', '?genesis=no#/zoltar?universe=11')
		setRuntimeNetworkProfile(getGenesisNetworkProfile(SEPOLIA_NETWORK_PROFILE, 'no'))
		cleanupRenderedComponent = (
			await renderIntoDocument(
				<UniverseNamesProvider universe={createUniverse()}>
					<UniverseBrowser activeUniverseId={yesUniverseId} universe={createUniverse()} />
				</UniverseNamesProvider>,
			)
		).cleanup
		const queries = within(document.body)
		expect(queries.getByRole('link', { name: 'Genesis › No' })).toBeTruthy()
		expect(queries.queryByRole('button', { name: 'Open Genesis › No' })).toBeNull()
		expect(queries.queryByRole('button', { name: 'Open Genesis › Yes' })).toBeNull()
		expect(queries.queryByRole('link', { name: 'Augur v2 universe' })).toBeNull()
		expect(queries.getByRole('link', { name: 'Open' }).getAttribute('href')).toContain('universe=21')
	})

	for (const outcome of ['yes', 'no'] as const) {
		test(`links the ${outcome} genesis root to its Augur parent through ordinary parent navigation`, async () => {
			window.history.replaceState({}, '', `?genesis=${outcome}&simulate=1&simState=saved#/zoltar?zoltarView=universes&universe=0`)
			setRuntimeNetworkProfile(getGenesisNetworkProfile(SEPOLIA_NETWORK_PROFILE, outcome))
			cleanupRenderedComponent = (await renderIntoDocument(<UniverseBrowser activeUniverseId={0n} universe={createUniverse({ childUniverses: [], hasForked: false, lineage: undefined, universeId: 0n })} />)).cleanup
			const queries = within(document.body)
			const field = queries.getByText('Parent universe').parentElement
			if (field === null) throw new Error('Expected the parent universe field')
			const parent = within(field).getByRole('link', { name: 'Augur v2 universe' })
			expect(parent.classList.contains('universe-parent-link')).toBe(true)
			expect(parent.getAttribute('href')).toBe('/?simulate=1#/')
			expect(queries.queryByRole('button', { name: 'Open Genesis › Yes' })).toBeNull()
		})
	}

	test('uses the active No root for its heading and parent when the URL has no choice', async () => {
		window.history.replaceState({}, '', '?simulate=1#/zoltar?zoltarView=universes&universe=0')
		setRuntimeNetworkProfile(getGenesisNetworkProfile(SEPOLIA_NETWORK_PROFILE, 'no'))
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseBrowser activeUniverseId={0n} universe={createUniverse({ childUniverses: [], hasForked: false, lineage: undefined, universeId: 0n })} />)).cleanup
		const queries = within(document.body)
		expect(queries.getByRole('heading', { name: 'Genesis › No' })).toBeTruthy()
		expect(queries.getByRole('link', { name: 'Augur v2 universe' }).getAttribute('href')).toBe('/?simulate=1#/')
		expect(queries.queryByText('Genesis › Yes')).toBeNull()
	})

	for (const outcome of ['yes', 'no'] as const) {
		test(`keeps the active ${outcome} root label when the URL names the other root`, async () => {
			window.history.replaceState({}, '', `?genesis=${outcome === 'yes' ? 'no' : 'yes'}#/zoltar?universe=0`)
			setRuntimeNetworkProfile(getGenesisNetworkProfile(SEPOLIA_NETWORK_PROFILE, outcome))
			cleanupRenderedComponent = (await renderIntoDocument(<UniverseBrowser activeUniverseId={0n} universe={createUniverse({ childUniverses: [], hasForked: false, lineage: undefined, universeId: 0n })} />)).cleanup
			expect(within(document.body).getByRole('heading', { name: outcome === 'yes' ? 'Genesis › Yes' : 'Genesis › No' })).toBeTruthy()
		})
	}

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
		expect(queries.getByRole('heading', { name: 'Genesis › Yes' })).toBeTruthy()
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
				<UniverseSwitcher browseHref='#/zoltar?zoltarView=universes' activeUniverseId={alphaUniverseId} includeRelatedUniverses={false} universe={universe} />
			</UniverseNamesProvider>
		)
		const rendered = await renderIntoDocument(tree(full))
		try {
			expect(document.querySelector('.universe-switcher-label')?.textContent).toBe('Alpha')
			expect(document.querySelector('.universe-switcher-label-parent')).toBeNull()
			expect(document.querySelector('.universe-switcher-label-leaf')).toBeNull()
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
				<UniverseSwitcher browseHref='#/zoltar?zoltarView=universes' activeUniverseId={alphaUniverseId} universe={universe} />
			</>,
		)
		try {
			const queries = within(document.body)
			expect(queries.queryByRole('link', { name: 'Genesis › Yes' })).toBeNull()
			expect(queries.getByRole('link', { name: 'Yes' }).getAttribute('href')).toContain('universe=11')
		} finally {
			await rendered.cleanup()
		}
	})

	test('does not label omitted child information as an empty tree in the header', async () => {
		const rendered = await renderIntoDocument(<UniverseSwitcher browseHref='#/zoltar?zoltarView=universes' activeUniverseId={yesUniverseId} universe={createUniverse({ relatedUniversesLoaded: false })} />)
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

	for (const leaf of ['Yes', 'Alpha', 'Alpha › Beta']) {
		test(`shows the ${leaf} descendant on its own row while retaining canonical ancestry`, async () => {
			const universe = createUniverse({
				universeId: alphaUniverseId,
				lineage: [
					{ outcomeLabel: undefined, universeId: 0n },
					{ outcomeLabel: 'Yes', universeId: yesUniverseId },
					{ outcomeLabel: leaf, universeId: alphaUniverseId },
				],
			})
			cleanupRenderedComponent = (await renderIntoDocument(<UniverseSwitcher activeUniverseId={alphaUniverseId} browseHref='#/zoltar?zoltarView=universes' universe={universe} />)).cleanup
			const label = `Genesis › Yes › Yes › ${leaf}`
			const link = within(document.body).getByRole('link', { name: `Universe: ${label}, forked. Browse universes` })
			expect(link.getAttribute('title')).toBe(label)
			expect(link.querySelector('.universe-switcher-label-parent')?.textContent).toBe('Genesis › Yes › Yes')
			expect(link.querySelector('.universe-switcher-label-leaf')?.textContent).toBe(leaf)
			expect(link.querySelector('.universe-switcher-badge')?.textContent).toBe('Forked')
		})
	}

	for (const outcome of ['yes', 'no'] as const) {
		test(`keeps the canonical ${outcome} root and actual leaf for a bounded summary`, async () => {
			window.history.replaceState({}, '', `?genesis=${outcome === 'yes' ? 'no' : 'yes'}#/zoltar?universe=21`)
			setRuntimeNetworkProfile(getGenesisNetworkProfile(SEPOLIA_NETWORK_PROFILE, outcome))
			const universe = createUniverse({ universeId: alphaUniverseId, parentUniverseId: yesUniverseId, lineage: undefined, outcomeLabel: 'Alpha', relatedUniversesLoaded: false })
			cleanupRenderedComponent = (await renderIntoDocument(<UniverseSwitcher activeUniverseId={alphaUniverseId} browseHref='#/zoltar?zoltarView=universes' universe={universe} />)).cleanup
			const root = outcome === 'yes' ? 'Genesis › Yes' : 'Genesis › No'
			const link = within(document.body).getByRole('link', { name: `Universe: ${root} · Alpha, forked. Browse universes` })
			expect(link.getAttribute('title')).toBe(`${root} · Alpha`)
			expect(link.querySelector('.universe-switcher-label-parent')?.textContent).toBe(`${root} ·`)
			expect(link.querySelector('.universe-switcher-label-leaf')?.textContent).toBe('Alpha')
			expect(link.querySelector('.universe-switcher-badge')?.textContent).toBe('Forked')
		})
	}

	test('keeps incomplete ancestry out of the contextual label', async () => {
		const universe = createUniverse({
			universeId: alphaUniverseId,
			outcomeLabel: 'Alpha',
			lineage: [
				{ outcomeLabel: 'Unverified parent', universeId: yesUniverseId },
				{ outcomeLabel: 'Alpha', universeId: alphaUniverseId },
			],
		})
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseSwitcher activeUniverseId={alphaUniverseId} browseHref='#/zoltar?zoltarView=universes' universe={universe} />)).cleanup
		const link = within(document.body).getByRole('link', { name: 'Universe: Genesis › Yes · Alpha, forked. Browse universes' })
		expect(link.querySelector('.universe-switcher-label-parent')?.textContent).toBe('Genesis › Yes ·')
		expect(link.querySelector('.universe-switcher-label-leaf')?.textContent).toBe('Alpha')
		expect(link.textContent).not.toContain('Unverified parent')
	})

	test('links directly to the browser for the active universe without a dropdown or child list', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseSwitcher activeUniverseId={yesUniverseId} browseHref='#/zoltar?zoltarView=universes&simulate=1&universe=999' universe={createUniverse()} />)).cleanup
		const link = within(document.body).getByRole('link', { name: 'Universe: Genesis › Yes › Yes, forked. Browse universes' })
		expect(link.getAttribute('href')).toBe('#/zoltar?zoltarView=universes&simulate=1&universe=11')
		expect(link.querySelector('.universe-switcher-badge')?.textContent).toBe('Forked')
		expect(document.querySelector('details')).toBeNull()
		expect(document.querySelector('.universe-switcher-popover')).toBeNull()
		expect(within(document.body).queryByRole('link', { name: 'Alpha' })).toBeNull()
	})

	test('shows no fork badge for a universe that has not forked', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseSwitcher activeUniverseId={yesUniverseId} browseHref='#/zoltar?zoltarView=universes' universe={createUniverse({ hasForked: false, forkTime: 0n })} />)).cleanup
		const link = within(document.body).getByRole('link', { name: 'Universe: Genesis › Yes › Yes. Browse universes' })
		expect(link.querySelector('.universe-switcher-badge')).toBeNull()
	})

	test('falls back to a short id while the active summary loads', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseSwitcher activeUniverseId={alphaUniverseId} browseHref='#/zoltar?zoltarView=universes' universe={createUniverse()} />)).cleanup
		const link = within(document.body).getByRole('link', { name: 'Universe: Universe 0x15. Browse universes' })
		expect(link.getAttribute('title')).toBe('Universe 0x15')
		expect(link.getAttribute('href')).toContain('universe=21')
		expect(link.querySelector('.universe-switcher-label-parent')).toBeNull()
		expect(link.querySelector('.universe-switcher-label-leaf')).toBeNull()
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
		expect(parentField?.querySelector('a')?.textContent).toBe('Genesis › Yes › Yes')
	})
})
