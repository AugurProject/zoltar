/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress } from 'viem'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'

type UseZoltarMigration = typeof import('../hooks/useZoltarMigration.js')['useZoltarMigration']
type UseZoltarMigrationState = ReturnType<UseZoltarMigration>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')

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

		expect(transactionFailures).toEqual(['Zoltar has not forked yet'])
		expect(requireHookState(hookState).zoltarMigrationError).toBeUndefined()
		expect(refreshState).not.toHaveBeenCalled()
		expect(refreshZoltarUniverse).not.toHaveBeenCalled()
		expect(refreshZoltarForkAccess).not.toHaveBeenCalled()
	})
})
