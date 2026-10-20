import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { usePortfolioSharedFork } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioSharedFork.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalSnapshot, token, unit } from './capitalFixture.js'
import { capitalClient, modules } from './capitalClient.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
async function setup() {
	const snapshot = capitalSnapshot({ forkTime: 900n })
	const source = capitalClient(snapshot)
	let chosen = false
	let started = false
	let ready = false
	const client = source.client.extend(() =>
		createMockReadClient(async request => {
			const values: Record<string, unknown> = {
				getForkChoiceDeadline: 2_000n,
				getForkRecapitalizationDeadline: 3_000n,
				forks: [100n * unit, 20n * unit, 10n * unit, 10n * unit, 2n * unit, 0n, 0n, 0n, true, false, true],
				choices: [1n, chosen],
				getChildUniverseId: 42n,
				getRepToken: token,
				branches: [0n, 1n, 0n, 0n, 0n, 0n, zeroAddress, chosen, started, ready],
				universes: [900n, 7n, 0n, false, 0n],
				zoltarQuestionData: token,
				questions: ['Fork question', 0n, 0n, 0n, 0n, 0n, 0n, ''],
				getOutcomeLabels: ['Yes'],
			}
			if (request.functionName in values) return values[request.functionName]
			return source.client.readContract(request)
		}),
	)
	installActiveEnvironmentForTesting({ ...source.backend, createReadClient: () => client })
	const requests: PortfolioTransaction[] = []
	const opened: bigint[] = []
	const actions = {
		scope: unscopedTransaction,
		busy: undefined,
		ownerReason: undefined,
		runPortfolioAction: async (_a: string, _t: string, build: () => PortfolioTransaction | Promise<PortfolioTransaction>) => {
			requests.push(await build())
		},
	}
	const hook = await renderHookWithProps(usePortfolioSharedFork, {
		snapshot,
		actions,
		openUniverse: (universe: bigint) => {
			opened.push(universe)
		},
	})
	lifecycle.trackRendered(hook)
	await act(() => hook.state().setOutcome('1'))
	await waitFor(() => expect(hook.state().state?.branch).toBeDefined())
	return {
		hook,
		requests,
		source,
		snapshot,
		opened,
		setChosen: (v: boolean) => {
			chosen = v
		},
		setStarted: (v: boolean) => {
			started = v
		},
		setReady: (v: boolean) => {
			ready = v
		},
	}
}
test('one irreversible choice has an explicit review and rechecks the strict native cutoff', async () => {
	const { hook, requests, source, snapshot } = await setup()
	expect(hook.state().chooseReason).toBeUndefined()
	await act(() => hook.state().choose())
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Choice request missing')
	expect(request.to).toBe(modules.fork)
	expect(decodeFunctionData({ abi: parseAbi(['function choose(uint248 source,uint256 outcome)']), data: request.data })).toEqual({ functionName: 'choose', args: [0n, 1n] })
	expect(request.reviewDescription).toContain('Irreversibly')
	source.setSnapshot({ ...snapshot, timestamp: 2_000n })
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('no longer available')
})
test('shared preparation waits until cutoff and activation waits until the recap deadline', async () => {
	const { hook, source, snapshot, requests } = await setup()
	expect(hook.state().startReason).toContain('choice deadline')
	expect(hook.state().finalizeReason).toContain('recap deadline')
	source.setSnapshot({ ...snapshot, timestamp: 2_000n, blockNumber: 11n })
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'11'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.timestamp).toBe(2_000n))
	expect(hook.state().startReason).toBeUndefined()
	await act(() => hook.state().start())
	expect(requests).toHaveLength(1)
	expect(hook.state().buyReason).toContain('no active recap sale')
})
test('fork actions distinguish invalid source input from an automatic pending read', async () => {
	const { hook, source } = await setup()
	await act(() => hook.state().setSource('invalid'))
	expect(hook.state().chooseReason).toBe('Enter a valid source universe.')
	const controller = createDeferred<typeof modules.fork>()
	source.setRead('forkController', controller.promise)
	await act(() => hook.state().setSource('1'))
	expect(hook.state().state).toBeUndefined()
	expect(hook.state().chooseReason).toBe('Checking fork status…')
	await act(() => controller.resolve(modules.fork))
	await waitFor(() => expect(hook.state().state).toBeDefined())
})
test('a recorded choice cannot be changed and a ready child opens its direct universe account', async () => {
	const { hook, setChosen, setStarted, setReady, snapshot, source, opened } = await setup()
	setChosen(true)
	setStarted(true)
	setReady(true)
	source.setSnapshot({ ...snapshot, timestamp: 3_001n })
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'22'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.branch?.ready).toBe(true))
	expect(hook.state().chooseReason).toContain('already recorded')
	expect(hook.state().startReason).toContain('already prepared')
	expect(hook.state().finalizeReason).toContain('already active')
	hook.state().open()
	expect(opened).toEqual([42n])
})
