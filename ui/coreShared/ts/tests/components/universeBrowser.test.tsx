/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { describe, expect, test } from 'bun:test'
import { UniverseBrowser } from '../../components/UniverseBrowser.js'
import { UniverseNamesProvider } from '../../components/UniverseNames.js'
import { UniverseSwitcher } from '../../components/UniverseSwitcher.js'
import type { ZoltarUniverseSummary } from '../../types/contracts.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { fireEvent, within } from '../testUtils/queries.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { installTestRouting } from '../testUtils/testRouting.js'

const yesUniverseId = 11n
const alphaUniverseId = 21n
const betaUniverseId = 22n

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [
			{ exists: true, forkTime: 0n, outcomeIndex: 1n, outcomeLabel: 'Alpha', parentUniverseId: yesUniverseId, reputationToken: zeroAddress, reputationTokenSymbol: 'REPa', universeId: alphaUniverseId },
			{ exists: false, forkTime: 0n, outcomeIndex: 2n, outcomeLabel: 'Beta', parentUniverseId: yesUniverseId, reputationToken: zeroAddress, universeId: betaUniverseId },
		],
		forkQuestionDetails: undefined,
		forkThresholdAttoRep: 1n,
		forkTime: 1n,
		forkingOutcomeIndex: 1n,
		hasForked: true,
		lineage: [
			{ outcomeLabel: undefined, universeId: 0n },
			{ outcomeLabel: 'Yes', universeId: yesUniverseId },
		],
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		reputationTokenName: 'Fork YES Reputation',
		reputationTokenSymbol: 'YESREP',
		totalTheoreticalSupplyAttoRep: 10n ** 18n,
		universeId: yesUniverseId,
		...overrides,
	}
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

	test('identifies the universe REP token in the collapsed details', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseBrowser activeUniverseId={yesUniverseId} universe={createUniverse()} />)).cleanup
		const field = within(document.body).getByText('Fork YES Reputation').parentElement
		expect(field?.textContent).toContain('YESREP')
		expect(field?.closest('details')?.open).toBe(false)
	})

	test('explains that an unforked universe has no children yet and hides the trail at Genesis', async () => {
		cleanupRenderedComponent = (await renderIntoDocument(<UniverseBrowser activeUniverseId={0n} universe={createUniverse({ childUniverses: [], hasForked: false, lineage: [{ outcomeLabel: undefined, universeId: 0n }], universeId: 0n })} />)).cleanup
		const queries = within(document.body)
		expect(document.body.querySelector('nav[aria-label="Universe lineage"]')).toBeNull()
		expect(queries.getByRole('heading', { name: 'Genesis' })).toBeTruthy()
		expect(queries.getByText('Child universes appear after this universe forks.')).toBeTruthy()
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

	test('names the active universe by lineage and offers ancestors, deployed children, and the browser', async () => {
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
