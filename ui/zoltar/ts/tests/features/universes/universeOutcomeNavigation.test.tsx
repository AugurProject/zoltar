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
import { getScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import type { UniverseOutcomePage } from '@zoltar/ui-zoltar-shared/protocol/universeNavigation.js'
import { appBlockWatcher } from '@zoltar/ui-core-shared/lib/dataRefresh.js'

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
	test('refreshes deployment statuses on the current page without clearing visible outcomes', async () => {
		const pending = createDeferred<UniverseOutcomePage>()
		const starts: bigint[] = []
		const loader: LoadUniverseOutcomes = async (_address, _id, start) => {
			starts.push(start)
			if (starts.length === 1) return { ...page, hasNextPage: true }
			if (starts.length === 2) return page
			return await pending.promise
		}
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={loader} />))
		const q = within(view.container)
		await waitFor(() => expect(q.getByRole('button', { name: 'Open Beta universe' }).hasAttribute('disabled')).toBe(true))
		fireEvent.click(q.getByRole('button', { name: 'Next page' }))
		await waitFor(() => expect(starts).toEqual([0n, 10n]))
		await waitFor(() => expect(q.queryByText('Loading outcomes…')).toBeNull())
		await act(() => appBlockWatcher.invalidate())
		await waitFor(() => expect(starts).toEqual([0n, 10n, 10n]))
		expect(q.queryByText('Loading outcomes…')).toBeNull()
		expect(q.getByRole('button', { name: 'Open Alpha universe' }).hasAttribute('disabled')).toBe(false)
		await act(async () => {
			pending.resolve({ ...page, choices: page.choices.map(choice => ({ ...choice, exists: true })) })
			await pending.promise
		})
		await waitFor(() => expect(q.getByRole('button', { name: 'Open Beta universe' }).hasAttribute('disabled')).toBe(false))
	})

	test('retains visible outcomes when a background refresh fails and offers retry', async () => {
		let calls = 0
		const loader: LoadUniverseOutcomes = async () => {
			if (++calls === 2) throw new Error('RPC unavailable')
			return page
		}
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={loader} />))
		const q = within(view.container)
		await waitFor(() => expect(q.queryByText('Alpha')).not.toBeNull())
		await act(() => appBlockWatcher.invalidate())
		await waitFor(() => expect(q.queryByText('Child outcomes could not be read. Reason: RPC unavailable')).not.toBeNull())
		expect(q.getByRole('button', { name: 'Open Alpha universe' }).hasAttribute('disabled')).toBe(false)
		fireEvent.click(q.getByRole('button', { name: 'Retry child outcomes' }))
		await waitFor(() => expect(q.queryByText('Alpha')).not.toBeNull())
		expect(q.queryByText('Child outcomes could not be read. Reason: RPC unavailable')).toBeNull()
		expect(calls).toBe(3)
	})

	test('keeps cards busy while paging and Retry load, but hides a failed page', async () => {
		const next = createDeferred<UniverseOutcomePage>()
		const retry = createDeferred<UniverseOutcomePage>()
		let calls = 0
		const loader: LoadUniverseOutcomes = async () => {
			calls++
			if (calls === 1) return { ...page, hasNextPage: true }
			return await (calls === 2 ? next.promise : retry.promise)
		}
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={loader} />))
		const q = within(view.container)
		await waitFor(() => expect(q.queryByText('Alpha')).not.toBeNull())
		fireEvent.click(q.getByRole('button', { name: 'Next page' }))
		await waitFor(() => expect(calls).toBe(2))
		expect(q.getByRole('button', { name: 'Open Alpha universe' }).hasAttribute('disabled')).toBe(true)
		expect(view.container.querySelector('[aria-busy="true"]')).toBeTruthy()
		expect(q.getByText('Loading')).toBeTruthy()
		await act(async () => {
			next.reject(new Error('RPC unavailable'))
			await Promise.resolve()
		})
		await waitFor(() => expect(q.queryByText('Child outcomes could not be read. Reason: RPC unavailable')).not.toBeNull())
		expect(q.queryByRole('button', { name: 'Open Alpha universe' })).toBeNull()
		fireEvent.click(q.getByRole('button', { name: 'Retry child outcomes' }))
		await waitFor(() => expect(calls).toBe(3))
		expect(q.getByRole('button', { name: 'Open Alpha universe' }).hasAttribute('disabled')).toBe(true)
		await act(async () => {
			retry.resolve({ ...page, choices: [{ label: 'Gamma', universeId: 30n, exists: true }] })
			await retry.promise
		})
		await waitFor(() => expect(q.queryByText('Gamma')).not.toBeNull())
		expect(q.queryByText('Alpha')).toBeNull()
		expect(q.getByRole('button', { name: 'Open Gamma universe' }).hasAttribute('disabled')).toBe(false)
		expect(q.getByText('Loading').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('true')
	})

	test('opens a deployed outcome directly from a migration-style card without requiring an ID', async () => {
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={async () => page} />))
		const q = within(view.container)
		await waitFor(() => expect(q.queryByText('Which proposal wins?')).not.toBeNull())
		const open = q.getByRole('button', { name: 'Open Alpha universe' })
		expect(view.container.querySelectorAll('.migration-outcome-row')).toHaveLength(2)
		expect(open.hasAttribute('aria-pressed')).toBe(false)
		const unavailable = q.getByRole('button', { name: 'Open Beta universe' })
		expect(unavailable.hasAttribute('disabled')).toBe(true)
		const descriptionId = unavailable.getAttribute('aria-describedby')
		if (descriptionId === null) throw new Error('Missing deployment-status description')
		expect(document.getElementById(descriptionId)?.textContent).toBe('Not deployed')
		expect(q.queryByRole('combobox')).toBeNull()
		fireEvent.click(open)
		expect(window.location.hash).toContain('universe=10')
	})

	test('shows loading and allows retry after a rejected read', async () => {
		const pending = createDeferred<UniverseOutcomePage>()
		let calls = 0
		const loader: LoadUniverseOutcomes = async () => (++calls === 1 ? await pending.promise : page)
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={loader} />))
		const q = within(view.container)
		expect(q.queryByText('Loading outcomes…')).not.toBeNull()
		expect(q.queryByRole('button', { name: 'Open Alpha universe' })).toBeNull()
		await act(async () => {
			pending.reject(new Error('RPC unavailable'))
			await Promise.resolve()
		})
		await waitFor(() => expect(q.queryByText('Child outcomes could not be read. Reason: RPC unavailable')).not.toBeNull())
		fireEvent.click(q.getByRole('button', { name: 'Retry child outcomes' }))
		await waitFor(() => expect(q.queryByText('Which proposal wins?')).not.toBeNull())
		expect(calls).toBe(2)
	})

	test('does not skip the failed page or open retained outcomes after Next fails', async () => {
		const starts: bigint[] = []
		const loader: LoadUniverseOutcomes = async (_address, _id, start) => {
			starts.push(start)
			if (starts.length === 2) throw new Error('RPC unavailable')
			return { ...page, hasNextPage: true, choices: [{ label: start === 0n ? 'Alpha' : 'Gamma', universeId: start === 0n ? 10n : 30n, exists: true }] }
		}
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={loader} />))
		const q = within(view.container)
		await waitFor(() => expect(q.queryByText('Alpha')).not.toBeNull())
		fireEvent.click(q.getByRole('button', { name: 'Next page' }))
		await waitFor(() => expect(q.queryByText('Child outcomes could not be read. Reason: RPC unavailable')).not.toBeNull())
		expect(q.queryByRole('button', { name: 'Open Alpha universe' })).toBeNull()
		const next = q.queryByRole('button', { name: 'Next page' })
		expect(next === null || next.hasAttribute('disabled')).toBe(true)
		if (next !== null) fireEvent.click(next)
		expect(starts).toEqual([0n, 10n])
		fireEvent.click(q.getByRole('button', { name: 'Retry child outcomes' }))
		await waitFor(() => expect(q.queryByText('Gamma')).not.toBeNull())
		expect(starts).toEqual([0n, 10n, 10n])
		fireEvent.click(q.getByRole('button', { name: 'Next page' }))
		await waitFor(() => expect(starts).toEqual([0n, 10n, 10n, 20n]))
	})

	test('can return to page one after the next page fails', async () => {
		const starts: bigint[] = []
		const loader: LoadUniverseOutcomes = async (_address, _id, start) => {
			starts.push(start)
			if (start > 0n) throw new Error('RPC unavailable')
			return { ...page, hasNextPage: true }
		}
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={loader} />))
		const q = within(view.container)
		await waitFor(() => expect(q.queryByText('Alpha')).not.toBeNull())
		fireEvent.click(q.getByRole('button', { name: 'Next page' }))
		await waitFor(() => expect(q.queryByText('Child outcomes could not be read. Reason: RPC unavailable')).not.toBeNull())
		expect(q.getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(false)
		expect(q.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true)
		fireEvent.click(q.getByRole('button', { name: 'Previous page' }))
		await waitFor(() => expect(q.queryByText('Alpha')).not.toBeNull())
		expect(q.queryByText('Child outcomes could not be read. Reason: RPC unavailable')).toBeNull()
		expect(starts).toEqual([0n, 10n, 0n])
	})

	test('paging replaces outcome cards and requests only the next page', async () => {
		const starts: bigint[] = []
		const loader: LoadUniverseOutcomes = async (_address, _universeId, start) => {
			starts.push(start)
			return start === 0n ? { ...page, hasNextPage: true } : { ...page, choices: [{ label: 'Gamma', universeId: 30n, exists: true }] }
		}
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={loader} />))
		const q = within(view.container)
		await waitFor(() => expect(q.queryByText('Alpha')).not.toBeNull())
		fireEvent.click(q.getByRole('button', { name: 'Next page' }))
		await waitFor(() => expect(q.queryByText('Gamma')).not.toBeNull())
		expect(q.queryByRole('button', { name: 'Open Alpha universe' })).toBeNull()
		expect(q.getByRole('button', { name: 'Open Gamma universe' }).hasAttribute('disabled')).toBe(false)
		expect(starts).toEqual([0n, 10n])
		fireEvent.click(q.getByRole('button', { name: 'Previous page' }))
		await waitFor(() => expect(q.queryByText('Alpha')).not.toBeNull())
		expect(starts).toEqual([0n, 10n, 0n])
	})

	test('does not retain cards across a loader change or accept the old loader reply', async () => {
		const old = createDeferred<UniverseOutcomePage>()
		const replacement = createDeferred<UniverseOutcomePage>()
		let calls = 0
		const loader: LoadUniverseOutcomes = async () => (++calls === 1 ? { ...page, hasNextPage: true } : await old.promise)
		const nextLoader: LoadUniverseOutcomes = async () => await replacement.promise
		const view = lifecycle.trackRendered(await renderIntoDocument(<UniverseOutcomeNavigation universe={universe} loadPage={loader} />))
		const q = within(view.container)
		await waitFor(() => expect(q.queryByText('Alpha')).not.toBeNull())
		fireEvent.click(q.getByRole('button', { name: 'Next page' }))
		await waitFor(() => expect(calls).toBe(2))
		await act(() => render(<UniverseOutcomeNavigation universe={universe} loadPage={nextLoader} />, view.container))
		expect(q.queryByText('Alpha')).toBeNull()
		await act(async () => {
			old.resolve(page)
			await old.promise
		})
		expect(q.queryByText('Alpha')).toBeNull()
		await act(async () => {
			replacement.resolve({ ...page, choices: [{ label: 'Delta', universeId: 40n, exists: true }] })
			await replacement.promise
		})
		await waitFor(() => expect(q.queryByText('Delta')).not.toBeNull())
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

	test('scalar forks use an exact picker and resolve only its selected child, even with huge tick counts', async () => {
		const question = { answerUnit: 'units', numTicks: 10n ** 25n, displayValueMin: 0n, displayValueMax: 10n ** 43n }
		const indexes: bigint[] = []
		const view = lifecycle.trackRendered(
			await renderIntoDocument(
				<UniverseOutcomeNavigation
					universe={universe}
					loadPage={async () => ({ ...page, choices: [], hasNextPage: false, scalarQuestion: question })}
					loadOutcome={async (_address, _id, index) => {
						indexes.push(index)
						return { universeId: 30n, exists: true }
					}}
				/>,
			),
		)
		const q = within(view.container)
		await waitFor(() => expect(q.queryByRole('textbox', { name: 'Scalar value' })).not.toBeNull())
		await waitFor(() => expect(indexes).toHaveLength(1))
		expect(view.container.querySelectorAll('.migration-outcome-row')).toHaveLength(0)
		expect(q.queryByRole('button', { name: 'Next page' })).toBeNull()
		expect(q.queryByRole('button', { name: 'Find outcome' })).toBeNull()
		fireEvent.input(q.getByRole('textbox', { name: 'Scalar value' }), { target: { value: '10000000000000000000000000' } })
		await waitFor(() => expect(q.getByRole('button', { name: 'Open 10000000000000000000000000 units universe' }).hasAttribute('disabled')).toBe(false))
		expect(indexes).toEqual([getScalarOutcomeIndex(question, 0n), getScalarOutcomeIndex(question, question.numTicks)])
		fireEvent.input(q.getByRole('textbox', { name: 'Scalar value' }), { target: { value: '10000000000000000000000001' } })
		await waitFor(() => expect(q.queryByText('Enter a value between the minimum and maximum that falls on an increment.')).not.toBeNull())
		expect(indexes).toHaveLength(2)
		expect(q.getByRole('button', { name: 'Open None universe' }).hasAttribute('disabled')).toBe(true)
		fireEvent.input(q.getByRole('textbox', { name: 'Scalar value' }), { target: { value: question.numTicks.toString() } })
		await waitFor(() => expect(q.getByRole('button', { name: 'Open 10000000000000000000000000 units universe' }).hasAttribute('disabled')).toBe(false))
		fireEvent.click(q.getByRole('button', { name: 'Open 10000000000000000000000000 units universe' }))
		expect(window.location.hash).toContain('universe=30')
	})

	test('scalar selection guards late replies, supports Invalid, and refreshes undeployed children', async () => {
		const question = { answerUnit: '°C', numTicks: 20n, displayValueMin: 0n, displayValueMax: 100n * 10n ** 18n }
		const pending = createDeferred<{ universeId: bigint; exists: boolean }>()
		let deployed = false
		const indexes: bigint[] = []
		const view = lifecycle.trackRendered(
			await renderIntoDocument(
				<UniverseOutcomeNavigation
					universe={universe}
					loadPage={async () => ({ ...page, choices: [], hasNextPage: false, scalarQuestion: question })}
					loadOutcome={async (_address, _id, index) => {
						indexes.push(index)
						return index === getScalarOutcomeIndex(question, 0n) ? await pending.promise : { universeId: 40n, exists: deployed }
					}}
				/>,
			),
		)
		const q = within(view.container)
		await waitFor(() => expect(q.queryByRole('slider', { name: 'Select outcome' })).not.toBeNull())
		await waitFor(() => expect(indexes).toHaveLength(1))
		fireEvent.input(q.getByRole('slider', { name: 'Select outcome' }), { target: { value: '10' } })
		await waitFor(() => expect(q.queryByText('Not deployed')).not.toBeNull())
		expect(q.getByRole('button', { name: 'Open 50 °C universe' }).hasAttribute('disabled')).toBe(true)
		await act(async () => {
			pending.resolve({ universeId: 99n, exists: true })
			await pending.promise
		})
		expect(q.getByRole('button', { name: 'Open 50 °C universe' }).hasAttribute('disabled')).toBe(true)
		deployed = true
		await act(() => appBlockWatcher.invalidate())
		await waitFor(() => expect(q.getByRole('button', { name: 'Open 50 °C universe' }).hasAttribute('disabled')).toBe(false))
		fireEvent.click(q.getByRole('checkbox', { name: 'Invalid' }))
		await waitFor(() => expect(q.getByRole('button', { name: 'Open Invalid universe' }).hasAttribute('disabled')).toBe(false))
		expect(indexes.at(-1)).toBe(0n)
	})

	test('moving the scalar slider reads only the final selection after it settles', async () => {
		const question = { answerUnit: '°C', numTicks: 20n, displayValueMin: 0n, displayValueMax: 100n * 10n ** 18n }
		const indexes: bigint[] = []
		const view = lifecycle.trackRendered(
			await renderIntoDocument(
				<UniverseOutcomeNavigation
					universe={universe}
					loadPage={async () => ({ ...page, choices: [], hasNextPage: false, scalarQuestion: question })}
					loadOutcome={async (_address, _id, index) => {
						indexes.push(index)
						return { universeId: 40n, exists: true }
					}}
				/>,
			),
		)
		const q = within(view.container)
		await waitFor(() => expect(indexes).toHaveLength(1))
		const slider = q.getByRole('slider', { name: 'Select outcome' })
		for (const value of ['1', '2', '3']) {
			fireEvent.input(slider, { target: { value } })
			await act(async () => await Bun.sleep(30))
		}
		await waitFor(() => expect(q.getByRole('button', { name: 'Open 15 °C universe' }).hasAttribute('disabled')).toBe(false))
		expect(indexes).toEqual([getScalarOutcomeIndex(question, 0n), getScalarOutcomeIndex(question, 3n)])
	})

	test('names the scalar outcome and preserves a nested timeout reason with a specific retry', async () => {
		const question = { answerUnit: '°C', numTicks: 20n, displayValueMin: 0n, displayValueMax: 100n * 10n ** 18n }
		const indexes: bigint[] = []
		const view = lifecycle.trackRendered(
			await renderIntoDocument(
				<UniverseOutcomeNavigation
					universe={universe}
					loadPage={async () => ({ ...page, choices: [], scalarQuestion: question })}
					loadOutcome={async (_address, _id, index) => {
						indexes.push(index)
						if (indexes.length === 1) throw new Error('Unknown error', { cause: new Error('RPC read timed out. Retry loading data.') })
						return { universeId: 40n, exists: true }
					}}
				/>,
			),
		)
		const q = within(view.container)
		await waitFor(() => expect(q.queryByText('The 0 °C universe deployment status could not be read. Reason: RPC read timed out. Retry loading data')).not.toBeNull())
		fireEvent.click(q.getByRole('button', { name: 'Retry 0 °C universe' }))
		await waitFor(() => expect(q.getByRole('button', { name: 'Open 0 °C universe' }).hasAttribute('disabled')).toBe(false))
		expect(indexes).toHaveLength(2)
	})

	test('explains when the data source supplies no usable error reason', async () => {
		const view = lifecycle.trackRendered(
			await renderIntoDocument(
				<UniverseOutcomeNavigation
					universe={universe}
					loadPage={async () => {
						throw undefined
					}}
				/>,
			),
		)
		await waitFor(() => expect(view.container.textContent).toContain('Child outcomes could not be read. Reason: The data source did not provide error details'))
		expect(within(view.container).getByRole('button', { name: 'Retry child outcomes' })).toBeTruthy()
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
