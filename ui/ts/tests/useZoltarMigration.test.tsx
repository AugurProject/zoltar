/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, type Hash, zeroAddress } from '@zoltar/shared/ethereum'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'

type UseZoltarMigration = typeof import('../hooks/useZoltarMigration.js')['useZoltarMigration']
type UseZoltarMigrationState = ReturnType<UseZoltarMigration>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [],
		forkThreshold: 100n,
		forkQuestionDetails: undefined,
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: true,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupply: 1000n,
		universeId: 1n,
		...overrides,
	}
}

function requireHookState(state: UseZoltarMigrationState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')

	return state
}

describe('useZoltarMigration', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let resetEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		resetEnvironment?.()
		resetEnvironment = undefined
		resetActiveEnvironmentForTesting()
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
	})

	test('reports transaction failures through the tray callback without leaving a local migration error', async () => {
		const refreshState = mock(async () => undefined)
		const refreshZoltarUniverse = mock(async () => undefined)
		const refreshZoltarForkAccess = mock(async () => undefined)
		const transactionFailures: string[] = []
		const onTransactionFailed = (message: string) => {
			transactionFailures.push(message)
		}

		mock.module('../lib/clients.js', () => ({
			createWalletWriteClient: mock(() => ({
				kind: 'write-client',
			})),
		}))

		const { useZoltarMigration } = await import(`../hooks/useZoltarMigration.js?case=${crypto.randomUUID()}`)
		let hookState: UseZoltarMigrationState | undefined
		const Harness = function ZoltarMigrationHarness() {
			const state = useZoltarMigration({
				accountAddress: WALLET_ADDRESS,
				ensureZoltarUniverse: async () => createUniverse({ hasForked: false }),
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState,
				refreshZoltarForkAccess,
				refreshZoltarUniverse,
				zoltarForkRepBalance: 10n ** 19n,
				zoltarMigrationPreparedRepBalance: 0n,
			})

			hookState = state

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setZoltarMigrationForm(current => ({
				...current,
				amount: '10',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).prepareRepForMigration()
		})

		expect(transactionFailures).toEqual(['Migration is unavailable because this universe has not forked'])
		expect(requireHookState(hookState).zoltarMigrationError).toBeUndefined()
		expect(refreshState).not.toHaveBeenCalled()
		expect(refreshZoltarUniverse).not.toHaveBeenCalled()
		expect(refreshZoltarForkAccess).not.toHaveBeenCalled()
	})

	test('does not request a migration transaction when the active wallet network changed', async () => {
		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting({
			...createFakeBackend({ accountAddress: WALLET_ADDRESS }),
			getChainId: async () => '0x5',
		})
		const ensureZoltarUniverse = mock(async () => createUniverse())
		const onTransactionRequested = mock(() => undefined)
		const onTransactionFailed = mock(() => undefined)

		const { useZoltarMigration } = await import(`../hooks/useZoltarMigration.js?case=${crypto.randomUUID()}`)
		let hookState: UseZoltarMigrationState | undefined
		const Harness = function ZoltarMigrationHarness() {
			const state = useZoltarMigration({
				accountAddress: WALLET_ADDRESS,
				ensureZoltarUniverse,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				refreshZoltarForkAccess: async () => undefined,
				refreshZoltarUniverse: async () => undefined,
				zoltarForkRepBalance: 10n ** 19n,
				zoltarMigrationPreparedRepBalance: 0n,
			})

			hookState = state

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setZoltarMigrationForm(current => ({
				...current,
				amount: '10',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).prepareRepForMigration()
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(ensureZoltarUniverse).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledWith('Transaction failed while attempting to prepare REP for migration. Reason: Wallet network changed. Switch to Ethereum Mainnet and try again')
	})

	test('migrateInternalRep snapshots the submitted form before universe preflight resolves', async () => {
		const universeLoad = createDeferred<ZoltarUniverseSummary>()
		const migrateInternalRepInZoltar = mock(async (_client: unknown, universeId: bigint, amount: bigint, outcomeIndexes: bigint[]) => {
			expect(universeId).toBe(1n)
			expect(amount).toBe(10n * 10n ** 18n)
			expect(outcomeIndexes).toEqual([1n, 2n])
			return {
				action: 'splitMigrationRep' as const,
				amount,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000cd' as Hash,
				outcomeIndexes,
				universeId,
			}
		})

		mock.module('../contracts.js', () => ({
			migrateInternalRepInZoltar,
			prepareRepForMigrationInZoltar: mock(async () => {
				throw new Error('prepareRepForMigrationInZoltar should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const refreshState = mock(async () => undefined)
		const refreshZoltarUniverse = mock(async () => undefined)
		const refreshZoltarForkAccess = mock(async () => undefined)
		const { useZoltarMigration } = await import(`../hooks/useZoltarMigration.js?case=${crypto.randomUUID()}`)
		let hookState: UseZoltarMigrationState | undefined
		const Harness = function ZoltarMigrationHarness() {
			const state = useZoltarMigration({
				accountAddress: WALLET_ADDRESS,
				ensureZoltarUniverse: async () => await universeLoad.promise,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState,
				refreshZoltarForkAccess,
				refreshZoltarUniverse,
				zoltarForkRepBalance: 100n * 10n ** 18n,
				zoltarMigrationPreparedRepBalance: 0n,
			})

			hookState = state

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setZoltarMigrationForm(current => ({
				...current,
				amount: '10',
				outcomeIndexes: '1, 2',
			}))
		})

		let migratePromise = Promise.resolve()
		await act(() => {
			migratePromise = requireHookState(hookState).migrateInternalRep()
		})

		await act(async () => {
			requireHookState(hookState).setZoltarMigrationForm(current => ({
				...current,
				amount: '20',
				outcomeIndexes: '3, 4',
			}))
		})

		await act(async () => {
			universeLoad.resolve(createUniverse())
			await migratePromise
		})

		expect(migrateInternalRepInZoltar).toHaveBeenCalledTimes(1)
		expect(refreshState).toHaveBeenCalledTimes(1)
		expect(refreshZoltarUniverse).toHaveBeenCalledTimes(1)
		expect(refreshZoltarForkAccess).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).zoltarMigrationFeedback?.status.tone).toBe('success')
	})
})
