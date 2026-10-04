/// <reference types='bun-types' />

import { getAddress, type Hash, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installModuleMocks } from '@zoltar/ui-core-shared/tests/testUtils/moduleMocks.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { createUniverseSummary } from '@zoltar/ui-core-shared/tests/testUtils/universeFixtures.js'

type UseZoltarMigration = typeof import('@zoltar/ui-zoltar-shared/features/universes/hooks/useZoltarMigration.js')['useZoltarMigration']
type UseZoltarMigrationState = ReturnType<UseZoltarMigration>
type UseZoltarMigrationParameters = Parameters<UseZoltarMigration>[0]
type MigrateInternalRepInZoltar = typeof import('@zoltar/ui-zoltar-shared/protocol/zoltarForks.js')['migrateInternalRepInZoltar']

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return createUniverseSummary({
		childUniverses: [1n, 2n, 3n, 4n].map(outcomeIndex => ({ exists: false, forkTime: 0n, outcomeIndex, outcomeLabel: `Outcome ${outcomeIndex.toString()}`, parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 10n + outcomeIndex })),
		forkThresholdAttoRep: 100n,
		forkTime: 1n,
		hasForked: true,
		totalTheoreticalSupplyAttoRep: 1000n,
		...overrides,
	})
}

function createChildUniverse(overrides: Partial<ZoltarUniverseSummary['childUniverses'][number]> = {}): ZoltarUniverseSummary['childUniverses'][number] {
	return { exists: true, forkTime: 1n, outcomeIndex: 1n, outcomeLabel: 'Yes', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 2n, ...overrides }
}

describe('useZoltarMigration', () => {
	const moduleMocks = installModuleMocks(specifier => import.meta.resolve(specifier))

	const { replaceEnvironment, trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: WALLET_ADDRESS, installActiveEnvironment: installActiveEnvironmentForTesting })

	async function mockMigrationWrites(migrateInternalRepInZoltar: (...parameters: Parameters<MigrateInternalRepInZoltar>) => ReturnType<MigrateInternalRepInZoltar>) {
		await moduleMocks.mockModule('@zoltar/ui-core-shared/wallet/clients.js', () => ({ createWalletWriteClient: mock(() => ({ kind: 'write-client' })) }))
		await moduleMocks.mockModule('@zoltar/ui-zoltar-shared/protocol/zoltarForks.js', () => ({ migrateInternalRepInZoltar }))
	}

	async function renderMigrationHook(overrides: Partial<UseZoltarMigrationParameters>) {
		const { useZoltarMigration } = await import(`@zoltar/ui-zoltar-shared/features/universes/hooks/useZoltarMigration.js?case=${crypto.randomUUID()}`)
		let hookState: UseZoltarMigrationState | undefined
		let switchUniverse: ((universeId: bigint) => void) | undefined
		const Harness = function ZoltarMigrationHarness() {
			const [activeUniverseId, setActiveUniverseId] = useState(1n)
			switchUniverse = setActiveUniverseId
			hookState = useZoltarMigration({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId,
				environmentRefreshKey: 0,
				ensureZoltarUniverse: async () => createUniverse(),
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				refreshZoltarForkAccess: async () => undefined,
				refreshZoltarUniverse: async () => undefined,
				...overrides,
			})
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)
		return {
			state: () => requireHookState(hookState),
			switchUniverse: (universeId: bigint) => switchUniverse?.(universeId),
		}
	}

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

		await mockMigrationWrites(migrateInternalRepInZoltar)
		const { state } = await renderMigrationHook({ onTransactionFailed, refreshState, refreshZoltarForkAccess, refreshZoltarUniverse })

		await act(async () => {
			state().setZoltarMigrationForm(current => ({
				...current,
				amount: '10',
				outcomeIndexes: [1n],
			}))
		})

		await act(async () => {
			await state().migrateInternalRep(10n * 10n ** 18n)
		})

		expect(migrateInternalRepInZoltar).toHaveBeenCalledTimes(1)
		if (writeFails) {
			expect(transactionFailures).toHaveLength(1)
			expect(transactionFailures[0]).toContain('Split rejected')
			expect(state().zoltarMigrationPending).toBe(false)
			expect(refreshState).not.toHaveBeenCalled()
			expect(refreshZoltarForkAccess).not.toHaveBeenCalled()
			return
		}
		expect(transactionFailures).toEqual([])
		expect(state().zoltarMigrationError).toBeUndefined()
		expect(refreshState).toHaveBeenCalledTimes(1)
		expect(refreshZoltarUniverse).toHaveBeenCalledTimes(1)
		expect(refreshZoltarForkAccess).toHaveBeenCalledTimes(1)
	})

	test('names outcomes in the transaction dialog and clears the amount after migrating', async () => {
		const migrateInternalRepInZoltar = mock(async (_client: unknown, universeId: bigint, amountAttoRep: bigint, outcomeIndexes: bigint[]) => ({
			action: 'splitMigrationRep' as const,
			amountAttoRep,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000ab' as Hash,
			outcomeIndexes,
			universeId,
		}))
		await mockMigrationWrites(migrateInternalRepInZoltar)
		const universe = createUniverse({
			childUniverses: [createChildUniverse(), createChildUniverse({ exists: false, forkTime: 0n, outcomeIndex: 2n, outcomeLabel: 'No', universeId: 3n })],
		})
		const requested: unknown[] = []
		const presented: unknown[] = []
		const { state } = await renderMigrationHook({
			ensureZoltarUniverse: async () => universe,
			onTransactionPresented: (presentation: unknown) => presented.push(presentation),
			onTransactionRequested: (intent: unknown) => {
				requested.push(intent)
			},
			refreshZoltarUniverse: async () => universe,
			zoltarUniverse: universe,
		})
		await act(async () => {
			state().setZoltarMigrationForm(current => ({ ...current, amount: '10', outcomeIndexes: [2n, 1n] }))
		})
		await act(async () => {
			await state().migrateInternalRep(0n)
		})

		expect(migrateInternalRepInZoltar.mock.calls[0]?.[3]).toEqual([2n, 1n])
		expect(requested).toMatchObject([{ rows: [{ label: 'Amount' }, { label: 'Outcomes', value: 'No, Yes' }], submittedTitle: 'Migrating REP' }])
		expect(presented).toMatchObject([{ rows: [{ label: 'Amount' }, { label: 'Outcomes', value: 'No, Yes' }], title: 'REP migrated' }])
		expect(state().zoltarMigrationForm).toEqual({ amount: '', outcomeIndexes: [2n, 1n] })
	})

	test('clears the selection on universe change and never submits outcomes from another universe', async () => {
		const migrateInternalRepInZoltar = mock(async () => {
			throw new Error('should not be called')
		})
		await mockMigrationWrites(migrateInternalRepInZoltar)
		const universe = createUniverse({ childUniverses: [createChildUniverse()] })
		const failures: string[] = []
		const { state, switchUniverse } = await renderMigrationHook({
			ensureZoltarUniverse: async () => universe,
			onTransactionFailed: (message: string) => failures.push(message),
			refreshZoltarUniverse: async () => universe,
		})
		await act(async () => {
			state().setZoltarMigrationForm(() => ({ amount: '10', outcomeIndexes: [1n, 5n] }))
		})
		await act(async () => {
			await state().migrateInternalRep(0n)
		})
		expect(migrateInternalRepInZoltar).not.toHaveBeenCalled()
		expect(failures).toHaveLength(1)

		await act(async () => {
			switchUniverse(2n)
		})
		expect(state().zoltarMigrationForm).toEqual({ amount: '', outcomeIndexes: [] })
	})

	test('does not request a migration transaction when the active wallet network changed', async () => {
		replaceEnvironment({
			...createFakeBackend({ accountAddress: WALLET_ADDRESS }),
			getChainId: async () => '0x5',
		})
		const ensureZoltarUniverse = mock(async () => createUniverse())
		const onTransactionRequested = mock(() => undefined)
		const onTransactionFailed = mock(() => undefined)

		const { state } = await renderMigrationHook({ ensureZoltarUniverse, onTransactionFailed, onTransactionRequested })

		await act(async () => {
			state().setZoltarMigrationForm(current => ({
				...current,
				amount: '10',
			}))
		})

		await act(async () => {
			await state().migrateInternalRep(10n * 10n ** 18n)
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(ensureZoltarUniverse).not.toHaveBeenCalled()
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(state().zoltarMigrationFeedback?.status.detail).toBe('Transaction failed while attempting to migrate REP. Reason: Wallet network changed. Switch to Ethereum mainnet and try again.')
		expect(state().zoltarMigrationError).toBe('Transaction failed while attempting to migrate REP. Reason: Wallet network changed. Switch to Ethereum mainnet and try again.')
	})

	test('migrateInternalRep snapshots the submitted form before universe preflight resolves', async () => {
		const universeLoad = createDeferred<ZoltarUniverseSummary>()
		const migrateInternalRepInZoltar = mock(async (_client: unknown, universeId: bigint, amount: bigint, outcomeIndexes: bigint[], preparationAttoRep: bigint) => {
			expect(universeId).toBe(1n)
			expect(amount).toBe(10n * 10n ** 18n)
			expect(outcomeIndexes).toEqual([1n, 2n])
			expect(preparationAttoRep).toBe(10n * 10n ** 18n)
			return {
				action: 'splitMigrationRep' as const,
				amountAttoRep: amount,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000cd' as Hash,
				outcomeIndexes,
				universeId,
			}
		})

		await mockMigrationWrites(migrateInternalRepInZoltar)

		const refreshState = mock(async () => undefined)
		const refreshedUniverse = createUniverse({ childUniverses: [createChildUniverse({ reputationToken: getAddress('0x00000000000000000000000000000000000000b2') })] })
		const refreshZoltarUniverse = mock(async () => refreshedUniverse)
		const refreshZoltarForkAccess = mock(async () => undefined)
		const { state } = await renderMigrationHook({ ensureZoltarUniverse: async () => await universeLoad.promise, refreshState, refreshZoltarForkAccess, refreshZoltarUniverse })

		await act(async () => {
			state().setZoltarMigrationForm(current => ({
				...current,
				amount: '10',
				outcomeIndexes: [1n, 2n],
			}))
		})

		let migratePromise = Promise.resolve()
		await act(() => {
			migratePromise = state().migrateInternalRep(10n * 10n ** 18n)
		})

		await state().migrateInternalRep(0n)

		await act(async () => {
			state().setZoltarMigrationForm(current => ({
				...current,
				amount: '20',
				outcomeIndexes: [3n, 4n],
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
		expect(state().zoltarMigrationFeedback?.status.tone).toBe('success')
	})
})
