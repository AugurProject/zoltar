/// <reference types='bun-types' />

import { type Address, getAddress, type Hash, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createMockLoaderClient, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createInitialTransactionTrayState, markTransactionFailed, markTransactionRequested } from '@zoltar/ui-core-shared/transactions/transactionTray.js'
import type { MarketDetails, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { useZoltarFork, type UseZoltarForkDependencies } from '@zoltar/ui-zoltar-shared/features/universes/hooks/useZoltarFork.js'
import { describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { createUniverseSummary } from '@zoltar/ui-core-shared/tests/testUtils/universeFixtures.js'

type UseZoltarForkState = ReturnType<typeof useZoltarFork>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')
const REPUTATION_TOKEN_ADDRESS = getAddress('0x00000000000000000000000000000000000000c3')

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return createUniverseSummary({
		forkThresholdAttoRep: 100n,
		forkTime: 1n,
		totalTheoreticalSupplyAttoRep: 1000n,
		...overrides,
	})
}

function createForkQuestion(questionId: string): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Fork question',
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId,
		startTime: 1n,
		title: 'Will this fork?',
	}
}

function createZoltarForkDependencies(overrides: Partial<UseZoltarForkDependencies> = {}): UseZoltarForkDependencies {
	return {
		approveForkRep: async () => {
			throw new Error('approveForkRep should not be called in this test')
		},
		forkZoltarUniverse: async () => {
			throw new Error('forkZoltarUniverse should not be called in this test')
		},
		loadZoltarForkAccess: async () => {
			throw new Error('loadZoltarForkAccess should not be called in this test')
		},
		...overrides,
	}
}

type UseZoltarForkParameters = Parameters<typeof useZoltarFork>[0]

function createForkParameters(overrides: Partial<UseZoltarForkParameters> = {}): UseZoltarForkParameters {
	const universe = overrides.zoltarUniverse ?? createUniverse({ reputationToken: REPUTATION_TOKEN_ADDRESS })
	return {
		accountAddress: WALLET_ADDRESS,
		activeUniverseId: 1n,
		environmentRefreshKey: 0,
		ensureZoltarUniverse: async () => universe,
		onTransactionFinished: () => undefined,
		onTransactionPresented: () => undefined,
		onTransactionRequested: () => undefined,
		onTransactionSubmitted: () => undefined,
		refreshState: async () => undefined,
		refreshZoltarUniverse: async () => undefined,
		shouldAutoLoadForkAccess: false,
		zoltarUniverse: universe,
		...overrides,
	}
}

function createForkAccessResults() {
	return [
		{ result: 100n, status: 'success' as const },
		{ result: 0n, status: 'success' as const },
		{ result: 0n, status: 'success' as const },
	]
}

describe('useZoltarFork', () => {
	const { replaceEnvironment, trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: NEXT_WALLET_ADDRESS, installActiveEnvironment: installActiveEnvironmentForTesting })

	async function renderForkHook(parameters: UseZoltarForkParameters, dependencies?: UseZoltarForkDependencies) {
		let hookState: UseZoltarForkState | undefined
		function Harness({ hookParameters }: { hookParameters: UseZoltarForkParameters }) {
			hookState = useZoltarFork(hookParameters, dependencies)
			return <div />
		}
		const rendered = await renderIntoDocument(h(Harness, { hookParameters: parameters }))
		trackCleanup(rendered.cleanup)
		return {
			state: () => requireHookState(hookState),
			rerender: (nextParameters: UseZoltarForkParameters) => render(h(Harness, { hookParameters: nextParameters }), rendered.container),
		}
	}

	test.each(['success', 'failure', 'short array', 'invalid value'])('reads child migration history in one batch (%s)', async batchState => {
		const childUniverses = [2n, 3n].map(universeId => ({ exists: true, forkTime: 1n, outcomeIndex: universeId, outcomeLabel: universeId.toString(), parentUniverseId: 1n, reputationToken: REPUTATION_TOKEN_ADDRESS, universeId }))
		const universe = createUniverse({ childUniverses, hasForked: true, reputationToken: REPUTATION_TOKEN_ADDRESS })
		const requests: unknown[][] = []
		const client = createMockLoaderClient({
			getBlock: async () => ({ timestamp: 0n }),
			readContract: async () => {
				throw new Error('Unexpected standalone read')
			},
			multicall: async request => {
				const contracts = [...request.contracts]
				requests.push(contracts)
				return contracts.map(contract => {
					const name = getContractFunctionName(contract)
					if (name.startsWith('getChildMigrationRepAmount')) {
						if (batchState === 'failure') return { status: 'failure', error: new Error('History unavailable') }
						if (batchState === 'short array') return { status: 'success', result: [25n] }
						if (batchState === 'invalid value') return { status: 'success', result: ['bad', 35n] }
						return { status: 'success', result: [25n, 35n] }
					}
					return { status: 'success', result: 10n }
				})
			},
		})
		replaceEnvironment({ ...createFakeBackend({ accountAddress: WALLET_ADDRESS }), createReadClient: () => client })
		const { state } = await renderForkHook(createForkParameters({ zoltarUniverse: universe }))
		await act(async () => {
			await state().loadZoltarForkAccess()
		})
		expect(requests).toHaveLength(1)
		const historyRequests = requests[0]?.filter(contract => getContractFunctionName(contract).startsWith('getChildMigrationRepAmount'))
		expect(historyRequests).toHaveLength(1)
		expect(historyRequests?.[0]).toMatchObject({ functionName: 'getChildMigrationRepAmountsAttoRep', args: [WALLET_ADDRESS, 1n, [2n, 3n]] })
		expect(state().zoltarMigrationChildSplitAmountsAttoRep['2']).toBe(batchState === 'success' ? 25n : undefined)
		expect(state().zoltarMigrationChildSplitAmountsAttoRep['3']).toBe(batchState === 'success' || batchState === 'invalid value' ? 35n : undefined)
		expect(state().zoltarMigrationChildRepBalancesAttoRep).toEqual({ '2': 10n, '3': 10n })
		expect(state().zoltarForkRepBalanceAttoRep).toBe(10n)
	})

	test.each(['fork', 'approval'])('does not request a %s transaction when the active wallet account changed', async action => {
		const ensureZoltarUniverse = mock(async () => createUniverse())
		const onTransactionRequested = mock(() => undefined)
		let transactionState = markTransactionRequested(createInitialTransactionTrayState(), { action: 'deploy', source: 'zoltar', submittedTitle: 'Deploying contracts' })
		const admittedIntent = transactionState.entries[0]?.intent
		const admittedRequestKey = transactionState.entries[0]?.key
		const admittedPresentation = transactionState.active
		const onTransactionFailed = mock((message: string) => {
			transactionState = markTransactionFailed(transactionState, { kind: 'error', message })
		})
		const { state } = await renderForkHook(createForkParameters({ ensureZoltarUniverse, onTransactionFailed, onTransactionRequested }), createZoltarForkDependencies())

		await act(async () => {
			if (action === 'approval') await state().approveZoltarForkRep(100n)
			else await state().forkZoltar()
		})

		expect(state().zoltarForkError).toContain('Wallet account changed')
		expect(state().zoltarForkFeedback?.status.detail).toBe(state().zoltarForkError)
		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(ensureZoltarUniverse).not.toHaveBeenCalled()
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(transactionState.entries.length).toBe(1)
		expect(transactionState.entries[0]?.intent).toBe(admittedIntent)
		expect(transactionState.entries[0]?.key).toBe(admittedRequestKey)
		expect(transactionState.active).toBe(admittedPresentation)
	})

	test('does not execute or finish a fork transaction rejected by the global admission gate', async () => {
		replaceEnvironment(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
		const ensureZoltarUniverse = mock(async () => createUniverse())
		const forkZoltarUniverse = mock(async () => {
			throw new Error('forkZoltarUniverse should not be called when admission is rejected')
		})
		const onTransactionFinished = mock(() => undefined)
		const { state } = await renderForkHook(createForkParameters({ ensureZoltarUniverse, onTransactionFinished, onTransactionRequested: () => false }), createZoltarForkDependencies({ forkZoltarUniverse }))

		await act(async () => {
			await state().forkZoltar()
		})

		expect(forkZoltarUniverse).not.toHaveBeenCalled()
		expect(ensureZoltarUniverse).not.toHaveBeenCalled()
		expect(onTransactionFinished).not.toHaveBeenCalled()
		expect(state().zoltarForkFeedback?.status.detail).toBeUndefined()
		expect(state().zoltarForkPending).toBe(false)
	})

	test('preserves question selection across accounts but scopes it by environment and universe', async () => {
		const scopedParameters = (accountAddress: Address, activeUniverseId: bigint, environmentRefreshKey: number) => createForkParameters({ accountAddress, activeUniverseId, environmentRefreshKey, zoltarUniverse: createUniverse({ universeId: activeUniverseId }) })
		const { rerender, state } = await renderForkHook(scopedParameters(WALLET_ADDRESS, 1n, 0), createZoltarForkDependencies())

		await act(async () => {
			state().setZoltarForkQuestionId('0x01')
		})
		expect(state().zoltarForkQuestionId).toBe('0x01')

		await act(async () => {
			rerender(scopedParameters(WALLET_ADDRESS, 2n, 0))
		})
		expect(state().zoltarForkQuestionId).toBe('')

		await act(async () => {
			state().setZoltarForkQuestionId('0x02')
			rerender(scopedParameters(WALLET_ADDRESS, 2n, 1))
		})
		expect(state().zoltarForkQuestionId).toBe('')

		await act(async () => {
			state().setZoltarForkQuestionId('0x03')
			rerender(scopedParameters(NEXT_WALLET_ADDRESS, 2n, 1))
		})
		expect(state().zoltarForkQuestionId).toBe('0x03')
	})

	test('forkZoltar snapshots the submitted question id before universe preflight resolves', async () => {
		const universeLoad = createDeferred<ZoltarUniverseSummary>()
		const forkZoltarUniverse = mock(async (_accountAddress: string, _callbacks: unknown, universeId: bigint, questionId: bigint) => {
			expect(universeId).toBe(1n)
			expect(questionId).toBe(11n)
			return {
				action: 'forkZoltar' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ab' as Hash,
				questionId: `0x${questionId.toString(16)}`,
				universeId,
			}
		})
		const loadZoltarForkAccess = mock(async () => createForkAccessResults())
		const dependencies = createZoltarForkDependencies({ forkZoltarUniverse, loadZoltarForkAccess })

		replaceEnvironment(createFakeBackend({ accountAddress: WALLET_ADDRESS }))

		const { state } = await renderForkHook(createForkParameters({ ensureZoltarUniverse: async () => await universeLoad.promise, onTransactionFailed: () => undefined }), dependencies)

		await act(async () => {
			state().setZoltarForkQuestionId('0x0b')
		})

		let forkPromise = Promise.resolve()
		await act(() => {
			forkPromise = state().forkZoltar()
		})

		await act(async () => {
			state().setZoltarForkQuestionId('0x0c')
		})

		await act(async () => {
			universeLoad.resolve(createUniverse({ reputationToken: REPUTATION_TOKEN_ADDRESS }))
			await forkPromise
		})

		expect(forkZoltarUniverse).toHaveBeenCalledTimes(1)
		expect(loadZoltarForkAccess).toHaveBeenCalledTimes(1)
		expect(state().zoltarForkFeedback?.status.tone).toBe('success')
		expect(state().zoltarForkResult?.questionId).toBe('0xb')
	})

	test('an earlier environment fork rejection cannot clear replacement environment feedback', async () => {
		const oldFork = createDeferred<Awaited<ReturnType<UseZoltarForkDependencies['forkZoltarUniverse']>>>()
		const newFork = createDeferred<Awaited<ReturnType<UseZoltarForkDependencies['forkZoltarUniverse']>>>()
		let forkCallCount = 0
		const forkZoltarUniverse: UseZoltarForkDependencies['forkZoltarUniverse'] = async () => {
			forkCallCount += 1
			return await (forkCallCount === 1 ? oldFork.promise : newFork.promise)
		}
		const dependencies = createZoltarForkDependencies({
			forkZoltarUniverse,
			loadZoltarForkAccess: async () => createForkAccessResults(),
		})
		replaceEnvironment(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
		const { rerender, state } = await renderForkHook(createForkParameters(), dependencies)
		await act(async () => state().setZoltarForkQuestionId('0x01'))
		let oldPromise = Promise.resolve()
		await act(() => {
			oldPromise = state().forkZoltar()
		})

		replaceEnvironment(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
		await act(async () => rerender(createForkParameters({ environmentRefreshKey: 1 })))
		await act(async () => state().setZoltarForkQuestionId('0x02'))
		let newPromise = Promise.resolve()
		await act(() => {
			newPromise = state().forkZoltar()
		})
		expect(state().zoltarForkPending).toBe(true)
		const replacementFeedback = state().zoltarForkFeedback

		await act(async () => {
			oldFork.reject(new Error('old environment fork failed'))
			await oldPromise
		})
		expect(state().zoltarForkPending).toBe(true)
		expect(state().zoltarForkActiveAction).toBe('fork')
		expect(state().zoltarForkFeedback).toBe(replacementFeedback)

		await act(async () => {
			newFork.resolve({
				action: 'forkZoltar',
				hash: `0x${'2'.repeat(64)}` as Hash,
				questionId: '0x2',
				universeId: 1n,
			})
			await newPromise
		})
		expect(state().zoltarForkPending).toBe(false)
	})

	function mockApproveForkRep(hash: Hash) {
		return mock(async (_accountAddress: string, _callbacks: { onTransactionSubmitted: (hash: Hash) => void }, _reputationToken: string, _amount: bigint, questionId: bigint, universeId: bigint) => ({
			action: 'approveForkRep' as const,
			hash,
			questionId: `0x${questionId.toString(16)}`,
			universeId,
		}))
	}

	test('approveZoltarForkRep uses the submitted question before the universe has forked', async () => {
		const approveForkRep = mockApproveForkRep('0x00000000000000000000000000000000000000000000000000000000000000ac')
		const loadZoltarForkAccess = mock(async () => createForkAccessResults())
		replaceEnvironment(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
		const { state } = await renderForkHook(createForkParameters({ onTransactionFailed: () => undefined }), createZoltarForkDependencies({ approveForkRep, loadZoltarForkAccess }))

		await act(async () => {
			state().setZoltarForkQuestionId('0x0e')
		})

		await act(async () => {
			await state().approveZoltarForkRep()
		})

		expect(approveForkRep).toHaveBeenCalledTimes(1)
		const approveCall = approveForkRep.mock.calls[0]
		if (approveCall === undefined) throw new Error('Expected approveForkRep call')
		expect(approveCall[0]).toBe(WALLET_ADDRESS)
		expect(typeof approveCall[1].onTransactionSubmitted).toBe('function')
		expect(approveCall[2]).toBe(REPUTATION_TOKEN_ADDRESS)
		expect(approveCall[3]).toBe(100n)
		expect(approveCall[4]).toBe(14n)
		expect(approveCall[5]).toBe(1n)
		expect(loadZoltarForkAccess).toHaveBeenCalledTimes(1)
		expect(state().zoltarForkFeedback?.status.tone).toBe('success')
		expect(state().zoltarForkResult?.questionId).toBe('0xe')
	})

	test('approveZoltarForkRep uses loaded fork details after a post-fork reload', async () => {
		const approveForkRep = mockApproveForkRep('0x00000000000000000000000000000000000000000000000000000000000000ad')
		const loadZoltarForkAccess = mock(async () => createForkAccessResults())
		const forkedUniverse = createUniverse({
			forkQuestionDetails: createForkQuestion('0x0f'),
			hasForked: true,
			reputationToken: REPUTATION_TOKEN_ADDRESS,
		})
		replaceEnvironment(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
		const { state } = await renderForkHook(createForkParameters({ onTransactionFailed: () => undefined, zoltarUniverse: forkedUniverse }), createZoltarForkDependencies({ approveForkRep, loadZoltarForkAccess }))

		expect(state().zoltarForkQuestionId).toBe('')

		await act(async () => {
			await state().approveZoltarForkRep()
		})

		expect(approveForkRep).toHaveBeenCalledTimes(1)
		const approveCall = approveForkRep.mock.calls[0]
		if (approveCall === undefined) throw new Error('Expected approveForkRep call')
		expect(approveCall[4]).toBe(15n)
		expect(approveCall[5]).toBe(1n)
		expect(loadZoltarForkAccess).toHaveBeenCalledTimes(1)
		expect(state().zoltarForkFeedback?.status.tone).toBe('success')
		expect(state().zoltarForkResult?.questionId).toBe('0xf')
	})

	function createChildUniverse(overrides: Partial<ZoltarUniverseSummary['childUniverses'][number]> = {}): ZoltarUniverseSummary['childUniverses'][number] {
		return {
			exists: true,
			forkTime: 1n,
			outcomeIndex: 1n,
			outcomeLabel: 'Yes',
			parentUniverseId: 1n,
			reputationToken: getAddress('0x00000000000000000000000000000000000000d4'),
			universeId: 2n,
			...overrides,
		}
	}

	const createForkedUniverse = (childUniverses: ZoltarUniverseSummary['childUniverses'] = []) => createUniverse({ childUniverses, hasForked: true, reputationToken: REPUTATION_TOKEN_ADDRESS })

	test('reloads child REP access when a split deploys an existing child universe id', async () => {
		const childUniverse = createChildUniverse({ exists: false, reputationToken: zeroAddress })
		const deployedChildUniverse = createChildUniverse()
		const loadZoltarForkAccess = mock(async (_accountAddress: string, _reputationToken: string, _universeId: bigint, childUniverses: ZoltarUniverseSummary['childUniverses']) => [
			...createForkAccessResults(),
			...childUniverses.map(() => ({ result: 10n, status: 'success' as const })),
			...childUniverses.map(() => ({ result: 25n, status: 'success' as const })),
		])
		const dependencies = createZoltarForkDependencies({ loadZoltarForkAccess })
		const { rerender, state } = await renderForkHook(createForkParameters({ shouldAutoLoadForkAccess: true, zoltarUniverse: createForkedUniverse([childUniverse]) }), dependencies)

		await act(async () => {
			await Promise.resolve()
		})
		expect(loadZoltarForkAccess).toHaveBeenCalledTimes(1)
		const refreshFromDeployment = state().loadZoltarForkAccess

		await act(async () => {
			rerender(createForkParameters({ shouldAutoLoadForkAccess: true, zoltarUniverse: createForkedUniverse([deployedChildUniverse]) }))
		})
		await act(async () => {
			await Promise.resolve()
		})

		await act(async () => {
			await refreshFromDeployment()
		})

		expect(loadZoltarForkAccess).toHaveBeenCalledTimes(3)
		expect(loadZoltarForkAccess.mock.calls[2]?.[3]).toEqual([deployedChildUniverse])
		expect(loadZoltarForkAccess.mock.calls[1]?.[3]).toEqual([deployedChildUniverse])
		expect(state().zoltarMigrationChildSplitAmountsAttoRep).toEqual({ '2': 25n })
		expect(state().zoltarMigrationChildRepBalancesAttoRep).toEqual({ '2': 10n })
	})

	test('drops another accounts child REP balance when the replacement read fails', async () => {
		const universe = createForkedUniverse([createChildUniverse()])
		const loadZoltarForkAccess = mock(async (accountAddress: string) => {
			if (accountAddress === WALLET_ADDRESS) return [...createForkAccessResults(), { result: 10n, status: 'success' as const }]
			return [...createForkAccessResults(), { error: new Error('Child balance unavailable'), status: 'failure' as const }]
		})
		const { rerender, state } = await renderForkHook(createForkParameters({ zoltarUniverse: universe }), createZoltarForkDependencies({ loadZoltarForkAccess }))

		await act(async () => {
			await state().loadZoltarForkAccess()
		})
		expect(state().hasLoadedZoltarForkAccess).toBe(true)
		expect(state().zoltarMigrationChildRepBalancesAttoRep).toEqual({ '2': 10n })

		rerender(createForkParameters({ accountAddress: NEXT_WALLET_ADDRESS, zoltarUniverse: universe }))
		expect(state().hasLoadedZoltarForkAccess).toBe(false)
		expect(state().zoltarMigrationChildRepBalancesAttoRep).toEqual({})
		await act(async () => {
			await state().loadZoltarForkAccess()
		})

		expect(state().hasLoadedZoltarForkAccess).toBe(true)
		expect(loadZoltarForkAccess.mock.calls[1]?.[0]).toBe(NEXT_WALLET_ADDRESS)
		expect(state().zoltarMigrationChildRepBalancesAttoRep).toEqual({})
	})

	test('keeps fork access cleared when an earlier account load resolves after disconnect', async () => {
		const deferred = createDeferred<ReturnType<typeof createForkAccessResults>>()
		const loadZoltarForkAccess = mock(async () => await deferred.promise)
		const universe = createForkedUniverse()
		const { rerender, state } = await renderForkHook(createForkParameters({ zoltarUniverse: universe }), createZoltarForkDependencies({ loadZoltarForkAccess }))
		expect(state().hasLoadedZoltarForkAccess).toBe(false)
		const pendingLoad = state().loadZoltarForkAccess()
		await act(async () => {
			await Promise.resolve()
		})

		expect(state().hasLoadedZoltarForkAccess).toBe(false)
		rerender(createForkParameters({ accountAddress: undefined, zoltarUniverse: universe }))
		expect(state().zoltarMigrationChildRepBalancesAttoRep).toEqual({})

		await act(async () => {
			deferred.resolve(createForkAccessResults())
			await pendingLoad
		})

		await act(async () => {
			await state().loadZoltarForkAccess()
		})

		const hookState = state()
		expect(hookState.hasLoadedZoltarForkAccess).toBe(false)
		expect(hookState.zoltarForkApproval.value).toBeUndefined()
		expect(hookState.zoltarForkRepBalanceAttoRep).toBeUndefined()
		expect(hookState.zoltarMigrationPreparedRepBalanceAttoRep).toBeUndefined()
		expect(hookState.zoltarMigrationChildRepBalancesAttoRep).toEqual({})
	})
})
