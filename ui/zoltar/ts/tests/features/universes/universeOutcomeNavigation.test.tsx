import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { createForkedUniverseSummary } from '@zoltar/ui-core-shared/tests/testUtils/universeFixtures.js'
import { UniverseOutcomeNavigation, type LoadUniverseOutcomes } from '@zoltar/ui-zoltar-shared/features/universes/components/UniverseOutcomeNavigation.js'
import type { UniverseOutcomePage } from '@zoltar/ui-zoltar-shared/protocol/universeNavigation.js'

const address = getAddress('0x00000000000000000000000000000000000000f1')
const universe = createForkedUniverseSummary({ universeId: 0n, zoltarAddress: address, relatedUniversesLoaded: false, childUniverses: [] })
const page: UniverseOutcomePage = {
	title: 'Which proposal wins?',
	hasNextPage: false,
	choices: [
		{ label: 'Alpha', universeId: 10n, exists: true },
		{ label: 'Beta', universeId: 20n, exists: false },
	],
}

const lifecycle = installDomTestLifecycle({
	url: 'http://localhost/#/zoltar?zoltarView=universes',
	beforeTest: () => {
		installTestRouting()
	},
})

describe('outcome-based universe traversal', () => {
	test('requires choosing a deployed outcome and navigates without entering a universe ID', async () => {
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={async () => page} />))
		const q = within(view.container)
		await waitFor(() => expect(q.queryByText('Which proposal wins?')).not.toBeNull())
		const select = q.getByRole('combobox', { name: 'Child universe outcome' })
		const open = q.getByRole('button', { name: 'Open child universe' })
		expect(open.hasAttribute('disabled')).toBe(true)
		expect(q.getByRole('option', { name: 'Beta — not deployed' }).hasAttribute('disabled')).toBe(true)
		fireEvent.change(select, { target: { value: '10' } })
		await waitFor(() => expect(open.hasAttribute('disabled')).toBe(false))
		expect(q.queryByText('Choose a deployed outcome to open its universe.')).toBeNull()
		fireEvent.click(open)
		expect(window.location.hash).toContain('universe=10')
	})

	test('shows loading and allows retry after a rejected read', async () => {
		const pending = createDeferred<UniverseOutcomePage>()
		let calls = 0
		const loader: LoadUniverseOutcomes = async () => (++calls === 1 ? await pending.promise : page)
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={loader} />))
		const q = within(view.container)
		expect(q.getByRole('combobox').hasAttribute('disabled')).toBe(true)
		expect(q.getByRole('button', { name: 'Open child universe' }).hasAttribute('disabled')).toBe(true)
		await act(async () => {
			pending.reject(new Error('RPC unavailable'))
			await Promise.resolve()
		})
		await waitFor(() => expect(q.queryByText('Unable to load child outcomes.')).not.toBeNull())
		fireEvent.click(q.getByRole('button', { name: 'Retry' }))
		await waitFor(() => expect(q.queryByText('Which proposal wins?')).not.toBeNull())
		expect(calls).toBe(2)
	})

	test('paging clears the selected child and requests only the next page', async () => {
		const starts: bigint[] = []
		const loader: LoadUniverseOutcomes = async (_address, _universeId, start) => {
			starts.push(start)
			return start === 0n ? { ...page, hasNextPage: true } : { ...page, choices: [{ label: 'Gamma', universeId: 30n, exists: true }] }
		}
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={loader} />))
		const q = within(view.container)
		await waitFor(() => expect(q.queryByText('Alpha')).not.toBeNull())
		fireEvent.change(q.getByRole('combobox'), { target: { value: '10' } })
		fireEvent.click(q.getByRole('button', { name: 'Next page' }))
		await waitFor(() => expect(q.queryByText('Gamma')).not.toBeNull())
		expect(q.getByRole('button', { name: 'Open child universe' }).hasAttribute('disabled')).toBe(true)
		expect(starts).toEqual([0n, 10n])
		fireEvent.click(q.getByRole('button', { name: 'Previous page' }))
		await waitFor(() => expect(q.queryByText('Alpha')).not.toBeNull())
		expect(starts).toEqual([0n, 10n, 0n])
	})

	test('a late read cannot replace outcomes after moving to another universe', async () => {
		const pending = createDeferred<UniverseOutcomePage>()
		const loader: LoadUniverseOutcomes = async (_address, id) => (id === 0n ? await pending.promise : { ...page, title: 'Child fork', choices: [{ label: 'Delta', universeId: 40n, exists: true }] })
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={loader} />))
		await act(() => render(<UniverseOutcomeNavigation universe={{ ...universe, universeId: 10n }} loadPage={loader} />, view.container))
		await waitFor(() => expect(view.container.textContent).toContain('Child fork'))
		await act(async () => {
			pending.resolve(page)
			await pending.promise
		})
		expect(view.container.textContent).toContain('Delta')
		expect(view.container.textContent).not.toContain('Alpha')
	})

	test('scalar value lookup jumps directly to a distant bounded page and validates exact values', async () => {
		const starts: bigint[] = []
		const loader: LoadUniverseOutcomes = async (_address, _id, start) => {
			starts.push(start)
			return { ...page, hasNextPage: true, scalarQuestion: { answerUnit: 'units', numTicks: 10n ** 25n, displayValueMin: 0n, displayValueMax: 10n ** 43n } }
		}
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={loader} />))
		const q = within(view.container)
		await waitFor(() => expect(q.queryByRole('textbox', { name: 'Find outcome by value' })).not.toBeNull())
		const input = q.getByRole('textbox', { name: 'Find outcome by value' })
		fireEvent.input(input, { target: { value: '10000000000000000000000000' } })
		await act(() => {
			const form = view.container.querySelector('form')
			if (form === null) throw new Error('Missing scalar form')
			form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
		})
		await waitFor(() => expect(starts).toEqual([0n, 10n ** 25n]))
		fireEvent.input(input, { target: { value: '1.5' } })
		await act(() => {
			const form = view.container.querySelector('form')
			if (form === null) throw new Error('Missing scalar form')
			form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
		})
		await waitFor(() => expect(q.queryByText('Enter an exact outcome value within the question’s range.')).not.toBeNull())
		expect(starts).toHaveLength(2)
	})

	test('unforked universes never request outcomes', async () => {
		let calls = 0
		const view = lifecycle.trackRendered(
			await renderIntoDocument(
				<UniverseOutcomeNavigation
					universe={{ ...universe, hasForked: false }}
					loadPage={async () => {
						calls++
						return page
					}}
				/>,
			),
		)
		expect(view.container.textContent).toBe('')
		expect(calls).toBe(0)
	})
})
