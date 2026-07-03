/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Hash } from 'viem'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { useZoltarUniverse } from '../hooks/useZoltarUniverse.js'
import type { DeploymentStatus, MarketDetails } from '../types/contracts.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type UseZoltarUniverseState = ReturnType<typeof useZoltarUniverse>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')
const TEST_HASH: Hash = '0x0000000000000000000000000000000000000000000000000000000000000001'

function requireHookState(state: UseZoltarUniverseState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')

	return state
}

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createZoltarDeploymentStatus(): DeploymentStatus {
	return {
		address: zeroAddress,
		dependencies: [],
		deploy: async () => TEST_HASH,
		deployed: true,
		id: 'zoltar',
		label: 'Zoltar',
	}
}

function createQuestion(questionId: string): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Question description',
		displayValueMax: 2n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId,
		startTime: 1n,
		title: `Question ${questionId}`,
	}
}

describe('useZoltarUniverse', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let resetEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: NEXT_WALLET_ADDRESS }))
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

	test('does not request a child-universe transaction when the active wallet account changed', async () => {
		const onTransactionRequested = mock(() => undefined)
		const onTransactionFailed = mock(() => undefined)
		let hookState: UseZoltarUniverseState | undefined
		const Harness = function ZoltarUniverseHarness() {
			hookState = useZoltarUniverse({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 1n,
				autoLoadInitialData: false,
				deploymentStatuses: [],
				environmentRefreshKey: 0,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).createChildUniverse(0n)
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledWith('Wallet account changed. Review the action with the connected account and try again')
	})

	test('ignores stale question page results after the environment refresh key changes', async () => {
		const oldPage = createDeferred<{
			pageIndex: number
			pageSize: number
			questionCount: bigint
			questions: MarketDetails[]
		}>()
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({})),
			createWalletWriteClient: mock(() => ({})),
		}))
		mock.module('../contracts.js', () => ({
			createZoltarChildUniverse: mock(async () => ({ hash: TEST_HASH })),
			loadAllZoltarQuestions: mock(async () => []),
			loadZoltarQuestionCount: mock(async () => 1n),
			loadZoltarQuestionPage: mock(async () => await oldPage.promise),
			loadZoltarUniverseSummary: mock(async () => ({
				childUniverses: [],
				forkQuestionDetails: undefined,
				forkThreshold: 100n,
				forkTime: 0n,
				forkingOutcomeIndex: 0n,
				hasForked: false,
				parentUniverseId: 0n,
				reputationToken: zeroAddress,
				totalTheoreticalSupply: 1000n,
				universeId: 1n,
			})),
		}))
		const { useZoltarUniverse: useTestZoltarUniverse } = await import(`../hooks/useZoltarUniverse.js?case=${crypto.randomUUID()}`)
		let hookState: UseZoltarUniverseState | undefined
		function Harness({ environmentRefreshKey }: { environmentRefreshKey: number }) {
			hookState = useTestZoltarUniverse({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 1n,
				autoLoadInitialData: true,
				deploymentStatuses: [createZoltarDeploymentStatus()],
				environmentRefreshKey,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
			})
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, { environmentRefreshKey: 0 }))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			void requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		await act(() => {
			render(h(Harness, { environmentRefreshKey: 1 }), renderedComponent.container)
		})
		await act(async () => {
			oldPage.resolve({
				pageIndex: 0,
				pageSize: 10,
				questionCount: 1n,
				questions: [createQuestion('0x01')],
			})
			await oldPage.promise
		})

		expect(requireHookState(hookState).zoltarQuestionPage).toBeUndefined()
		expect(requireHookState(hookState).zoltarQuestions).toEqual([])
	})
})
