import { expect, spyOn, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { keccak256 } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import { waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { InheritedReporterClaims } from '@zoltar/ui-statoblast-shared/features/reporting/components/InheritedReporterClaims.js'
import { LocateReportingDeposits } from '@zoltar/ui-statoblast-shared/features/reporting/components/LocateReportingDeposits.js'
import { reportingDepositCursorStore } from '@zoltar/ui-statoblast-shared/protocol/reportingDepositSearch.js'
import type { ActiveReportingDetails, EscalationSide } from '@zoltar/ui-statoblast-shared/types/contracts.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const account = '0x0000000000000000000000000000000000000001' as const
const parent = '0x0000000000000000000000000000000000000002' as const
const game = '0x0000000000000000000000000000000000000003' as const
const side = testDouble<EscalationSide>({ key: 'yes', label: 'Yes', localPrincipalAttoRep: 1n, userDeposits: [], importedUserDeposits: [] })
const details = testDouble<ActiveReportingDetails>({ status: 'active', currentTime: 1n, forkContinuation: true, parentQuestionLedgerAddress: parent, escalationGameAddress: game, questionLedgerAddress: parent, reportingDepositPool: parent, reportingQuestionId: 1n, universeId: 0n, questionOutcome: 'yes', sides: [side] })
const callbacks = { onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }

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
		await act(() => render(element(2n), view.container))
		expect(attempts).toBe(1)
	} finally {
		stalled.reject(new Error('Fixture closed'))
	}
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
