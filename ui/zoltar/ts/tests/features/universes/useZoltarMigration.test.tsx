/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, type Hash, zeroAddress } from '@zoltar/shared/evm/ethereum'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'

type UseZoltarMigration = typeof import('@zoltar/ui-zoltar-shared/features/universes/hooks/useZoltarMigration.js')['useZoltarMigration']
type UseZoltarMigrationState = ReturnType<UseZoltarMigration>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [],
		forkThresholdAttoRep: 100n,
		forkQuestionDetails: undefined,
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: true,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 1000n,
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

	test.each([false, true])('handles the combined split and refresh lifecycle (write failure: %s)', async writeFails => {
		const migrateInternalRepInZoltar = mock(async () => {
			if (writeFails) throw new Error('Split rejected')
			return {
				action: 'splitMigrationRep' as const,
				amountAttoRep: 10n * 10n ** 18n,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000aa' as Hash,
				outcomeIndexes: [],
				universeId: 1n,
			}
		})
		const refreshState = mock(async () => undefined)
		const refreshZoltarUniverse = mock(async () => undefined)
		const refreshZoltarForkAccess = mock(async () => undefined)
		const transactionFailures: string[] = []
		const onTransactionFailed = (message: string) => {
			transactionFailures.push(message)
		}

		mock.module('@zoltar/ui-core-shared/wallet/clients.js', () => ({
			createWalletWriteClient: mock(() => ({
				kind: 'write-client',
			})),
		}))
		mock.module('@zoltar/ui-zoltar-shared/protocol/zoltarForks.js', () => ({
			migrateInternalRepInZoltar,
		}))

		const { useZoltarMigration } = await import(`@zoltar/ui-zoltar-shared/features/universes/hooks/useZoltarMigration.js?case=${crypto.randomUUID()}`)
		let hookState: UseZoltarMigrationState | undefined
		const Harness = function ZoltarMigrationHarness() {
			const state = useZoltarMigration({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 1n,
				environmentRefreshKey: 0,
				ensureZoltarUniverse: async () => createUniverse(),
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState,
				refreshZoltarForkAccess,
				refreshZoltarUniverse,
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
				outcomeIndexes: '1',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).migrateInternalRep(10n * 10n ** 18n)
		})

		expect(migrateInternalRepInZoltar).toHaveBeenCalledTimes(1)
		if (writeFails) {
			expect(transactionFailures).toHaveLength(1)
			expect(transactionFailures[0]).toContain('Split rejected')
			expect(requireHookState(hookState).zoltarMigrationPending).toBe(false)
			expect(refreshState).not.toHaveBeenCalled()
			expect(refreshZoltarForkAccess).not.toHaveBeenCalled()
			return
		}
		expect(transactionFailures).toEqual([])
		expect(requireHookState(hookState).zoltarMigrationError).toBeUndefined()
		expect(refreshState).toHaveBeenCalledTimes(1)
		expect(refreshZoltarUniverse).toHaveBeenCalledTimes(1)
		expect(refreshZoltarForkAccess).toHaveBeenCalledTimes(1)
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

		const { useZoltarMigration } = await import(`@zoltar/ui-zoltar-shared/features/universes/hooks/useZoltarMigration.js?case=${crypto.randomUUID()}`)
		let hookState: UseZoltarMigrationState | undefined
		const Harness = function ZoltarMigrationHarness() {
			const state = useZoltarMigration({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 1n,
				environmentRefreshKey: 0,
				ensureZoltarUniverse,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				refreshZoltarForkAccess: async () => undefined,
				refreshZoltarUniverse: async () => undefined,
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
			await requireHookState(hookState).migrateInternalRep(10n * 10n ** 18n)
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(ensureZoltarUniverse).not.toHaveBeenCalled()
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(requireHookState(hookState).zoltarMigrationFeedback?.status.detail).toBe('Transaction failed while attempting to migrate REP. Reason: Wallet network changed. Switch to Ethereum Mainnet and try again')
	})

	test('migrateInternalRep snapshots the submitted form before universe preflight resolves', async () => {
		const universeLoad = createDeferred<ZoltarUniverseSummary>()
		const migrateInternalRepInZoltar = mock(async (_client: unknown, universeId: bigint, amount: bigint, outcomeIndexes: bigint[], maxPreparationAttoRep: bigint) => {
			expect(universeId).toBe(1n)
			expect(amount).toBe(10n * 10n ** 18n)
			expect(outcomeIndexes).toEqual([1n, 2n])
			expect(maxPreparationAttoRep).toBe(10n * 10n ** 18n)
			return {
				action: 'splitMigrationRep' as const,
				amountAttoRep: amount,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000cd' as Hash,
				outcomeIndexes,
				universeId,
			}
		})

		mock.module('@zoltar/ui-zoltar-shared/protocol/zoltarForks.js', () => ({
			migrateInternalRepInZoltar,
		}))
		mock.module('@zoltar/ui-core-shared/wallet/clients.js', () => ({
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const refreshState = mock(async () => undefined)
		const refreshedUniverse = createUniverse({
			childUniverses: [
				{
					exists: true,
					forkTime: 1n,
					outcomeIndex: 1n,
					outcomeLabel: 'Yes',
					parentUniverseId: 1n,
					reputationToken: getAddress('0x00000000000000000000000000000000000000b2'),
					universeId: 2n,
				},
			],
		})
		const refreshZoltarUniverse = mock(async () => refreshedUniverse)
		const refreshZoltarForkAccess = mock(async () => undefined)
		const { useZoltarMigration } = await import(`@zoltar/ui-zoltar-shared/features/universes/hooks/useZoltarMigration.js?case=${crypto.randomUUID()}`)
		let hookState: UseZoltarMigrationState | undefined
		const Harness = function ZoltarMigrationHarness() {
			const state = useZoltarMigration({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 1n,
				environmentRefreshKey: 0,
				ensureZoltarUniverse: async () => await universeLoad.promise,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState,
				refreshZoltarForkAccess,
				refreshZoltarUniverse,
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
			migratePromise = requireHookState(hookState).migrateInternalRep(10n * 10n ** 18n)
		})

		await requireHookState(hookState).migrateInternalRep(0n)

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
		expect(refreshZoltarForkAccess).toHaveBeenCalledWith(refreshedUniverse)
		expect(requireHookState(hookState).zoltarMigrationFeedback?.status.tone).toBe('success')
	})
})
