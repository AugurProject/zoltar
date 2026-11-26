import { expect, spyOn, test } from 'bun:test'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { appBlockWatcher } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { localEntityScopeForNetwork, setEntityFavorite, setEntityFavoriteLabel } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createMulticallStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import { installStatoblastRouting, statoblastPageHash, statoblastPageHref } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { statoblastDisplayCache } from '@zoltar/ui-statoblast-shared/protocol/statoblastPageCache.js'
import { decodeWatchlistRows } from '@zoltar/ui-statoblast-shared/protocol/watchlistRows.js'
import { StatoblastWatchlist } from '../../app/components/StatoblastWatchlist.js'
import { openHistory } from '../../app/lib/watchlistHistory.js'

const lifecycle = installDomTestLifecycle()
const profile = createFakeBackend().profile
const pool = '0x0000000000000000000000000000000000000001'
const question = { kind: 'question', pool, questionId: 1n, tab: 'shares' } as const

test('opening tabs of the same entity leaves one history entry per universe', () => {
	const history = openHistory(profile)
	history.add({ ...question, tab: 'reporting' }, 'Will it resolve?', 7n)
	history.add(question, formatQuestionIdHex(question.questionId), 7n)
	history.add({ ...question, tab: 'claims' }, 'Child universe question', 8n)
	history.add({ kind: 'pool', pool, tab: 'price' }, pool, 7n)
	history.add({ kind: 'pool', pool, tab: 'capital' }, pool, 7n)

	const entries = history.read()
	expect(entries.map(entry => [entry.title, entry.universe])).toEqual([
		[pool, '7'],
		['Child universe question', '8'],
		['Will it resolve?', '7'],
	])
	expect(entries[2]?.hash).toBe(statoblastPageHash(question))
})

test('a resolved title keeps the original opening time and history order', () => {
	const clock = spyOn(Date, 'now')
	try {
		const history = openHistory(profile)
		clock.mockReturnValue(1_000)
		history.add(question, formatQuestionIdHex(question.questionId), 7n)
		clock.mockReturnValue(2_000)
		history.add({ kind: 'pool', pool, tab: 'capital' }, pool, 7n)
		clock.mockReturnValue(3_000)
		history.updateTitle({ ...question, tab: 'reporting' }, 'Will it resolve?', 7n)
		const entries = history.read()
		expect(entries.map(entry => [entry.title, entry.opened])).toEqual([
			[pool, 2_000],
			['Will it resolve?', 1_000],
		])
	} finally {
		clock.mockRestore()
	}
})

test('recent rows show the pool address, age, star, and an Open link for the recorded universe', async () => {
	installStatoblastRouting()
	const restoreEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile }))
	const clock = spyOn(Date, 'now')
	const confirm = spyOn(window, 'confirm').mockReturnValue(false)
	try {
		clock.mockReturnValue(1_000)
		const history = openHistory(profile)
		history.add({ kind: 'pool', pool, tab: 'capital' }, pool, 7n)
		history.add(question, 'Will it resolve?', 7n)
		const cachedBranch = statoblastDisplayCache(profile, { universeId: 7n, owner: undefined, page: 'watchlist' }, decodeWatchlistRows)
		cachedBranch.write([{ entity: { kind: 'question', id: `${pool}:0x1`, pool, questionId: 1n }, status: 'question', reportingPrincipal: 1n }], { number: 1n, timestamp: 1n })
		clock.mockReturnValue(7_201_000)
		const view = lifecycle.trackRendered(await renderIntoDocument(<StatoblastWatchlist enabled={false} environmentKey={0} owner={undefined} universe={0n} registerPageRefresh={() => () => undefined} />))
		const section = within(view.container).getByRole('heading', { name: 'Recently opened' }).closest('section')
		if (section === null) throw new Error('Recently opened section missing')
		const [questionRow, poolRow] = section.querySelectorAll('li')
		if (questionRow === undefined || poolRow === undefined) throw new Error('Recently opened rows missing')
		expect(questionRow.textContent).toContain('Will it resolve?')
		expect(questionRow.textContent).toContain(pool)
		expect(questionRow.textContent).toContain('opened 2h ago')
		expect(questionRow.textContent).toContain('Universe 0x7')
		expect(poolRow.textContent).toContain('opened 2h ago')
		expect(section.textContent).toContain('Last 20 opened')
		const questionStar = within(questionRow).getByRole('button', { name: `Favorite: Will it resolve? in security pool ${pool}` })
		expect(questionStar.getAttribute('aria-pressed')).toBe('false')
		const poolStar = within(poolRow).getByRole('button', { name: `Favorite: Security pool ${pool}` })
		expect(poolStar.getAttribute('aria-pressed')).toBe('false')
		expect(within(questionRow).getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(statoblastPageHref(question, 7n))
		await act(() => questionStar.click())
		expect(questionStar.getAttribute('aria-pressed')).toBe('true')
		expect(view.container.textContent).toContain('Saved questions')
		await act(() => questionStar.click())
		expect(confirm).toHaveBeenCalledTimes(1)
		expect(questionStar.getAttribute('aria-pressed')).toBe('true')
		await act(() => within(section).getByRole('button', { name: 'Clear history' }).click())
		expect(history.read()).toEqual([])
	} finally {
		confirm.mockRestore()
		clock.mockRestore()
		restoreEnvironment()
	}
})

test('a Fork and recovery open is retained as the destination for the pool', () => {
	const history = openHistory(profile)
	const capital = { kind: 'pool', pool, tab: 'capital' } as const
	const fork = { ...capital, tab: 'fork' } as const
	history.add(capital, pool, 0n)
	history.add(fork, pool, 0n)
	expect(history.read().map(item => item.hash)).toEqual([statoblastPageHash(fork)])
})

test('a saved question displays its verified title and ignores an old imported label', async () => {
	installStatoblastRouting()
	const restoreEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile }))
	try {
		const id = `${pool}:${formatQuestionIdHex(question.questionId)}`
		setEntityFavoriteLabel(localEntityScopeForNetwork(profile, 'statoblast', 'question'), id, 'Forged title')
		const cache = statoblastDisplayCache(profile, { universeId: 0n, owner: undefined, page: 'watchlist' }, decodeWatchlistRows)
		cache.write([{ entity: { ...question, id }, status: 'question', question: { marketDetails: { title: 'Verified title', endTime: 1n }, ordinaryEscalationGameStarted: false, questionOutcome: 'none', universeHasForked: false } }], { number: 1n, timestamp: 1n })
		const view = lifecycle.trackRendered(await renderIntoDocument(<StatoblastWatchlist enabled={false} environmentKey={0} owner={undefined} universe={0n} registerPageRefresh={() => () => undefined} />))
		expect(view.container.textContent).toContain('Verified title')
		expect(view.container.textContent).not.toContain('Forged title')
	} finally {
		restoreEnvironment()
	}
})

test('a complete Watchlist auto-refresh rotation advances the displayed age and caches every row', async () => {
	installStatoblastRouting()
	const backend = createFakeBackend({ profile })
	const favoriteScope = localEntityScopeForNetwork(profile, 'statoblast', 'pool')
	for (let index = 1; index <= 36; index++) {
		const id: Address = `0x${index.toString(16).padStart(40, '0')}`
		setEntityFavorite(favoriteScope, id, true, index)
	}
	let blockNumber = 1n
	let lastRead: number | undefined
	let progress: string | undefined
	const chunkSizes: number[] = []
	const client = testDouble<ReturnType<typeof backend.createReadClient>>({
		getBlock: async ({ blockNumber: pinned }: { blockNumber?: bigint } = {}) => ({ number: pinned ?? blockNumber, timestamp: pinned ?? blockNumber, hash: `0x${(pinned ?? blockNumber).toString(16).padStart(64, '0')}` }),
		getCode: async () => undefined,
		multicall: createMulticallStub(({ contracts }) => {
			chunkSizes.push(contracts.length)
			return contracts.map(() => ({ status: 'success', result: false }))
		}),
	})
	const restoreEnvironment = installActiveEnvironmentForTesting({ ...backend, createReadClient: () => client })
	const clock = spyOn(Date, 'now').mockReturnValue(1_000)
	const cache = statoblastDisplayCache(profile, { universeId: 0n, owner: undefined, page: 'watchlist' }, decodeWatchlistRows)
	try {
		appBlockWatcher.reportBlock(blockNumber)
		lifecycle.trackRendered(
			await renderIntoDocument(
				<StatoblastWatchlist
					enabled
					environmentKey={0}
					owner={undefined}
					universe={0n}
					registerPageRefresh={() => () => undefined}
					onReadStatus={(readAt, pending) => {
						lastRead = readAt
						progress = pending
					}}
				/>,
			),
		)
		await waitFor(() => expect(cache.read()?.savedAt).toBe(1_000))
		const advanceBlock = async (number: bigint, time: number, expectedChunks: number[]) => {
			blockNumber = number
			clock.mockReturnValue(time)
			await act(() => appBlockWatcher.reportBlock(blockNumber))
			await waitFor(() => {
				expect(chunkSizes).toEqual(expectedChunks)
				expect(progress).toBeUndefined()
			})
		}
		await advanceBlock(2n, 2_000, [25, 11, 25, 10])
		expect(lastRead).toBe(1_000)
		expect(cache.read()?.savedAt).toBe(1_000)
		await advanceBlock(3n, 3_000, [25, 11, 25, 10, 25, 1])
		expect(lastRead).toBe(2_000)
		expect(cache.read()).toMatchObject({ savedAt: 2_000, timestamp: 2n })
		expect(cache.read()?.value).toHaveLength(36)
	} finally {
		clock.mockRestore()
		restoreEnvironment()
	}
})
