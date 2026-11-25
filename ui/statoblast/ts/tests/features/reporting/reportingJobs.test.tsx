import { expect, spyOn, test } from 'bun:test'
import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { keccak256, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createBlockWithTimestamp, createMulticallStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import { waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { InheritedReporterClaims } from '@zoltar/ui-statoblast-shared/features/reporting/components/InheritedReporterClaims.js'
import { LocateReportingDeposits } from '@zoltar/ui-statoblast-shared/features/reporting/components/LocateReportingDeposits.js'
import { reportingDepositCursorStore } from '@zoltar/ui-statoblast-shared/protocol/reportingDepositSearch.js'
import { reportingDepositStore } from '@zoltar/ui-statoblast-shared/protocol/reportingDeposits.js'
import type { ActiveReportingDetails, EscalationDeposit, EscalationSide } from '@zoltar/ui-statoblast-shared/types/contracts.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const account = '0x0000000000000000000000000000000000000001' as const
const parent = '0x0000000000000000000000000000000000000002' as const
const game = '0x0000000000000000000000000000000000000003' as const
const side = testDouble<EscalationSide>({ key: 'yes', label: 'Yes', localPrincipalAttoRep: 1n, userDeposits: [], importedUserDeposits: [] })
const details = testDouble<ActiveReportingDetails>({ status: 'active', currentTime: 1n, forkContinuation: true, parentQuestionLedgerAddress: parent, escalationGameAddress: game, questionLedgerAddress: parent, reportingDepositPool: parent, reportingQuestionId: 1n, universeId: 0n, questionOutcome: 'yes', sides: [side] })
const callbacks = { onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }

test('deposit search separates the device’s located stake from the stake still to find', async () => {
	const missingStake = { ...side, localPrincipalAttoRep: 620n * 10n ** 18n, userDeposits: [{ depositor: account, depositIndex: 1n, amountAttoRep: 500n * 10n ** 18n, cumulativeAmountAttoRep: 500n * 10n ** 18n }] }
	const view = lifecycle.trackRendered(await renderIntoDocument(<LocateReportingDeposits details={{ ...details, sides: [missingStake] }} wallet={account} refresh={callbacks.refreshState} />))
	const amounts = [...view.container.querySelectorAll('dd')].map(item => item.textContent?.replace(/\s+/gu, ' '))
	expect(amounts).toContain('500.00 REP (1 deposit)')
	expect(amounts).toContain('120.00 REP')
	expect(view.container.textContent).toContain('Your REP is safe')
})

test('a visible inherited claim job is not restarted when another block arrives', async () => {
	const backend = createFakeBackend({ accountAddress: account })
	let attempts = 0
	const stalled = createDeferred<bigint>()
	installActiveEnvironmentForTesting({
		...backend,
		createReadClient: () =>
			testDouble({
				getBlockNumber: () => {
					attempts++
					return stalled.promise
				},
			}),
	})
	const accountState = createAccountState({ address: account, chainId: backend.profile.chainIdHex })
	const element = (currentTime: bigint) => <InheritedReporterClaims parameters={{ ...callbacks, accountAddress: account }} accountState={accountState} details={{ ...details, currentTime }} onRefresh={callbacks.refreshState} />
	const view = lifecycle.trackRendered(await renderIntoDocument(element(1n)))
	try {
		await act(() => within(view.container).getByRole('button', { name: 'Prepare inherited claims' }).click())
		expect(attempts).toBe(1)
		expect(view.container.querySelector('progress[aria-label="Inherited reporter claims"]')?.hasAttribute('value')).toBe(false)
		await act(() => render(element(2n), view.container))
		expect(attempts).toBe(1)
	} finally {
		stalled.reject(new Error('Fixture closed'))
	}
})

test('inherited claim preparation keeps a single pending RPC across outcomes and timeout retries', async () => {
	const backend = createFakeBackend({ accountAddress: account })
	const stalled = createDeferred<bigint>()
	let requests = 0
	let pending = true
	const hash = keccak256('0x10')
	installActiveEnvironmentForTesting({
		...backend,
		createReadClient: () =>
			testDouble({
				getBlockNumber: async () => {
					requests++
					return pending ? await stalled.promise : 10n
				},
				getBlock: async () => ({ ...createBlockWithTimestamp(20n), hash, number: 10n }),
				readContract: async () => zeroAddress,
			}),
	})
	const shortened = new Proxy(globalThis.setTimeout, {
		apply(schedule, receiver, [handler, delay, ...args]) {
			return Reflect.apply(schedule, receiver, [handler, [500, 2000, 5000, 15_000].includes(delay) ? 0 : delay, ...args])
		},
	})
	const timer = spyOn(globalThis, 'setTimeout').mockImplementation(shortened)
	const accountState = createAccountState({ address: account, chainId: backend.profile.chainIdHex })
	try {
		const view = lifecycle.trackRendered(await renderIntoDocument(<InheritedReporterClaims parameters={{ ...callbacks, accountAddress: account }} accountState={accountState} details={{ ...details, sides: [side, { ...side, key: 'no', label: 'No' }] }} onRefresh={callbacks.refreshState} />))
		const findRetry = () => within(view.container).getByRole('button', { name: 'Try again' })
		await act(() => within(view.container).getByRole('button', { name: 'Prepare inherited claims' }).click())
		await waitFor(() => expect(findRetry()).toBeDefined())
		expect(requests).toBe(1)
		pending = false
		stalled.resolve(10n)
		await act(() => findRetry().click())
		await waitFor(() => expect(view.container.textContent).toContain('No inherited claims for this wallet.'))
		expect(requests).toBe(3)
	} finally {
		stalled.resolve(10n)
		timer.mockRestore()
	}
})

test('a reorganized deposit cursor discards stale located stake before deciding the search is complete', async () => {
	const backend = createFakeBackend({ accountAddress: account })
	const hash = keccak256('0x21')
	const oldHash = keccak256('0x20')
	const starts: bigint[] = []
	const amountAttoRep = 10n ** 18n
	const deposit = (depositor: typeof account | typeof parent) => ({ depositor, amountAttoRep, cumulativeAmountAttoRep: amountAttoRep })
	installActiveEnvironmentForTesting({
		...backend,
		createReadClient: () =>
			testDouble({
				getBlock: async ({ blockNumber = 10n } = {}) => ({ ...createBlockWithTimestamp(20n), hash, number: blockNumber }),
				multicall: createMulticallStub(({ contracts }) =>
					contracts.map(call => {
						if (call.functionName === 'getDepositsByOutcomeLength') return { status: 'success', result: 71n }
						const start = call.args?.[1]
						if (typeof start !== 'bigint') throw new Error('Missing deposit offset')
						starts.push(start)
						const remaining = Number(71n - start)
						const length = Math.max(0, Math.min(remaining, 30))
						return { status: 'success', result: Array.from({ length }, (_, index) => deposit([40n, 70n].includes(start + BigInt(index)) ? account : parent)) }
					}),
				),
			}),
	})
	const searchSide = { pool: parent, questionId: 1n, universeId: 0n, depositor: account, outcome: 'yes' as const }
	reportingDepositCursorStore(backend.profile, searchSide).write({ block: 7n, hash: oldHash, nextIndex: 60n })
	const orphaned = { ...deposit(account), depositIndex: 5n }
	let refreshes = 0
	const refresh = async () => {
		refreshes++
	}
	lifecycle.trackRendered(await renderIntoDocument(<LocateReportingDeposits details={{ ...details, sides: [{ ...side, localPrincipalAttoRep: 2n * amountAttoRep, userDeposits: [orphaned] }] }} wallet={account} refresh={refresh} openOnEntry />))
	await waitFor(() => expect(refreshes).toBe(2))
	expect(starts).toEqual([0n, 30n, 60n, 90n])
	expect(
		reportingDepositStore(backend.profile)
			.read()
			.map(item => item.index),
	).toEqual([40n, 70n])
})

test('a partial result refreshes the claim data before the search continues from its live cursor', async () => {
	const backend = createFakeBackend({ accountAddress: account })
	const hash = keccak256('0x31')
	const starts: bigint[] = []
	const amountAttoRep = 10n ** 18n
	const publication = createDeferred<void>()
	const store = reportingDepositStore(backend.profile)
	let refreshes = 0
	let blockReads = 0
	installActiveEnvironmentForTesting({
		...backend,
		createReadClient: () =>
			testDouble({
				getBlock: async ({ blockNumber = 10n } = {}) => {
					blockReads++
					return { ...createBlockWithTimestamp(20n), hash, number: blockNumber }
				},
				multicall: createMulticallStub(({ blockNumber, contracts }) =>
					contracts.map(call => {
						if (call.functionName === 'getDepositsByOutcomeLength') return { status: 'success', result: blockNumber === 7n ? 10n : 71n }
						const start = call.args?.[1]
						if (typeof start !== 'bigint') throw new Error('Missing deposit offset')
						starts.push(start)
						const length = Math.max(0, Math.min(30, Number(71n - start)))
						const result = Array.from({ length }, (_, offset) => ({ depositor: [40n, 70n].includes(start + BigInt(offset)) ? account : parent, amountAttoRep, cumulativeAmountAttoRep: amountAttoRep }))
						return { status: 'success', result }
					}),
				),
			}),
	})
	function SearchWithReportingRefresh() {
		const [userDeposits, setUserDeposits] = useState<EscalationDeposit[]>([])
		const refresh = async () => {
			refreshes++
			setUserDeposits(store.read().map(({ depositor, index }) => ({ depositor, depositIndex: index, amountAttoRep, cumulativeAmountAttoRep: amountAttoRep })))
			await publication.promise
		}
		return <LocateReportingDeposits details={{ ...details, sides: [{ ...side, localPrincipalAttoRep: 2n * amountAttoRep, userDeposits }] }} wallet={account} refresh={refresh} openOnEntry />
	}
	try {
		const view = lifecycle.trackRendered(await renderIntoDocument(<SearchWithReportingRefresh />))
		await waitFor(() => expect(view.container.textContent).toContain('(1 deposit)'))
		await Bun.sleep(30)
		expect(refreshes).toBe(1)
		expect(blockReads).toBe(4)
		expect(starts).toEqual([0n, 30n])
		await act(async () => {
			publication.resolve()
			await publication.promise
		})
		await waitFor(() => expect(refreshes).toBe(2))
		expect(starts).toEqual([0n, 30n, 60n, 90n])
	} finally {
		publication.resolve()
	}
})

test('Search again clears an exhausted deposit cursor and locates an earlier deposit', async () => {
	const backend = createFakeBackend({ accountAddress: account })
	const hash = keccak256('0x30')
	const starts: bigint[] = []
	installActiveEnvironmentForTesting({
		...backend,
		createReadClient: () =>
			testDouble({
				getBlock: async ({ blockNumber = 10n } = {}) => ({ ...createBlockWithTimestamp(20n), hash, number: blockNumber }),
				multicall: createMulticallStub(({ contracts }) =>
					contracts.map(call => {
						if (call.functionName === 'getDepositsByOutcomeLength') return { status: 'success', result: 1n }
						const start = call.args?.[1]
						if (typeof start !== 'bigint') throw new Error('Missing deposit offset')
						starts.push(start)
						return { status: 'success', result: start === 0n ? [{ depositor: account, amountAttoRep: 1n, cumulativeAmountAttoRep: 1n }] : [] }
					}),
				),
			}),
	})
	reportingDepositCursorStore(backend.profile, { pool: parent, questionId: 1n, universeId: 0n, depositor: account, outcome: 'yes' }).write({ block: 7n, hash, nextIndex: 1n })
	const view = lifecycle.trackRendered(await renderIntoDocument(<LocateReportingDeposits details={details} wallet={account} refresh={callbacks.refreshState} openOnEntry />))
	const findRetry = () => within(view.container).getByRole('button', { name: 'Search again' })
	await waitFor(() => expect(findRetry()).toBeDefined())
	expect(view.container.textContent?.replace(/\s+/gu, ' ')).toContain("Couldn't find deposits for 0.000000000000000001 REP. Your REP is safe.")
	await act(() => findRetry().click())
	await waitFor(() =>
		expect(
			reportingDepositStore(backend.profile)
				.read()
				.map(item => item.index),
		).toEqual([0n]),
	)
	expect(starts).toEqual([1n, 31n, 0n, 30n])
})

test('Search again keeps the confirmed deposit cursor after an RPC failure', async () => {
	const backend = createFakeBackend({ accountAddress: account })
	installActiveEnvironmentForTesting({
		...backend,
		createReadClient: () =>
			testDouble({
				getBlock: async () => {
					throw new Error('Unavailable RPC')
				},
			}),
	})
	const cursors = reportingDepositCursorStore(backend.profile, { pool: parent, questionId: 1n, universeId: 0n, depositor: account, outcome: 'yes' })
	const cursor = { block: 1n, hash: keccak256('0x01'), nextIndex: 60n }
	cursors.write(cursor)
	const shortened = new Proxy(globalThis.setTimeout, {
		apply(schedule, receiver, [handler, delay, ...args]) {
			return Reflect.apply(schedule, receiver, [handler, delay === 250 || delay === 1000 || delay === 4000 ? 0 : delay, ...args])
		},
	})
	const timer = spyOn(globalThis, 'setTimeout').mockImplementation(shortened)
	try {
		const view = lifecycle.trackRendered(await renderIntoDocument(<LocateReportingDeposits details={details} wallet={account} refresh={callbacks.refreshState} openOnEntry />))
		const findRetry = () => within(view.container).getByRole('button', { name: 'Search again' })
		await waitFor(() => expect(findRetry()).toBeDefined())
		await act(() => findRetry().click())
		expect(cursors.read()).toEqual(cursor)
	} finally {
		timer.mockRestore()
	}
})

test('a deposit search waits for the timed-out request to settle before sending another', async () => {
	const backend = createFakeBackend({ accountAddress: account })
	const stalled = createDeferred<never>()
	let requests = 0
	installActiveEnvironmentForTesting({
		...backend,
		createReadClient: () =>
			testDouble({
				getBlock: async () => {
					requests++
					return await stalled.promise
				},
			}),
	})
	const shortened = new Proxy(globalThis.setTimeout, {
		apply(schedule, receiver, [handler, delay, ...args]) {
			return Reflect.apply(schedule, receiver, [handler, [250, 1000, 4000, 15_000].includes(delay) ? 0 : delay, ...args])
		},
	})
	const timer = spyOn(globalThis, 'setTimeout').mockImplementation(shortened)
	try {
		const view = lifecycle.trackRendered(await renderIntoDocument(<LocateReportingDeposits details={details} wallet={account} refresh={callbacks.refreshState} openOnEntry />))
		const findRetry = () => within(view.container).getByRole('button', { name: 'Search again' })
		await waitFor(() => expect(findRetry()).toBeDefined())
		expect(requests).toBe(1)
		stalled.reject(new Error('Connection closed'))
		await act(() => findRetry().click())
		await waitFor(() => expect(requests).toBeGreaterThan(1))
	} finally {
		stalled.reject(new Error('Fixture closed'))
		timer.mockRestore()
	}
})

test('manual deposit lookup can finish while the background search RPC is still pending', async () => {
	const backend = createFakeBackend({ accountAddress: account })
	const stalled = createDeferred<never>()
	let searchStarted = false
	installActiveEnvironmentForTesting({
		...backend,
		createReadClient: () =>
			testDouble({
				getBlock: () => {
					searchStarted = true
					return stalled.promise
				},
				readContract: async () => [{ depositor: account, amountAttoRep: 1n, cumulativeAmountAttoRep: 1n }],
			}),
	})
	try {
		const view = lifecycle.trackRendered(await renderIntoDocument(<LocateReportingDeposits details={details} wallet={account} refresh={callbacks.refreshState} openOnEntry />))
		await waitFor(() => expect(searchStarted).toBe(true))
		const input = view.container.querySelector('input')
		if (input === null || input.form === null) throw new Error('Missing manual lookup form')
		const form = input.form
		await act(() => {
			input.value = '5'
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
		await waitFor(() =>
			expect(
				reportingDepositStore(backend.profile)
					.read()
					.map(item => item.index),
			).toEqual([5n]),
		)
	} finally {
		stalled.reject(new Error('Fixture closed'))
	}
})

test('a page with an unavailable confirmed count preserves the saved search cursor', async () => {
	const backend = createFakeBackend({ accountAddress: account })
	const hash = keccak256('0x55')
	const cursors = reportingDepositCursorStore(backend.profile, { pool: parent, questionId: 1n, universeId: 0n, depositor: account, outcome: 'yes' })
	const cursor = { block: 7n, hash, nextIndex: 30n }
	cursors.write(cursor)
	installActiveEnvironmentForTesting({
		...backend,
		createReadClient: () =>
			testDouble({
				getBlock: async ({ blockNumber = 10n } = {}) => ({ ...createBlockWithTimestamp(20n), hash, number: blockNumber }),
				multicall: createMulticallStub(({ contracts, blockNumber }) =>
					contracts.map(call => {
						if (call.functionName !== 'getDepositsByOutcomeLength') return { status: 'success', result: [] }
						if (blockNumber === 7n) return { status: 'failure', error: new Error('Unavailable count') }
						return { status: 'success', result: 30n }
					}),
				),
			}),
	})
	const view = lifecycle.trackRendered(await renderIntoDocument(<LocateReportingDeposits details={details} wallet={account} refresh={callbacks.refreshState} openOnEntry />))
	await waitFor(() => expect(within(view.container).getByRole('button', { name: 'Search again' })).toBeDefined())
	expect(cursors.read()).toEqual(cursor)
})
