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
import { capitalSnapshot, token, capital, owner, unit } from './capitalFixture.js'
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

async function recoverySetup() {
	const fixture = await setup()
	fixture.source.setRead('questionOriginIds', `0x${'11'.repeat(32)}`)
	fixture.source.setRead('sourceGame', zeroAddress)
	fixture.source.setRead('getSecurityPool', token)
	fixture.source.setRead('getPool', token)
	fixture.source.setRead('shareToken', token)
	fixture.source.setRead('balanceOfPortfolioRecoveryRights', [3n * unit, 5n * unit, 4n * unit])
	fixture.source.setRead('isPortfolioRecoveryEligible', true)
	await act(() => fixture.hook.state().setQuestion('7'))
	await waitFor(() => expect(fixture.hook.state().recovery?.availableShares).toBe(3n * unit))
	return fixture
}
test('outcome recovery transfer reviews one exact transaction before the choice deadline and rechecks each right', async () => {
	const { hook, source, requests } = await recoverySetup()
	expect(hook.state().recoverReason).toContain('choice deadline')
	await act(() => {
		hook.state().setRecipient(capital)
		hook.state().setInvalidRights('1')
		hook.state().setNoRights('2')
	})
	expect(hook.state().transferReason).toBeUndefined()
	await act(() => hook.state().transfer())
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Recovery transfer request missing')
	expect(request).toMatchObject({ to: token, account: owner, value: 0n })
	expect(decodeFunctionData({ abi: parseAbi(['function transferPortfolioRecoveryRights(uint248 source,address recipient,uint256[3] amounts)']), data: request.data })).toEqual({ functionName: 'transferPortfolioRecoveryRights', args: [0n, capital, [unit, 0n, 2n * unit]] })
	expect(request.reviewDescription).toContain('1 Invalid, 0 Yes and 2 No')
	expect(request.reviewDescription).toContain('question 0x7 in source universe 0')
	expect(request.reviewDescription).toContain(capital)
	expect(request.reviewDescription).toContain('child migration rights remain yours')
	await request.validateBeforeSubmit?.()
	await act(() => hook.state().setNoRights('1'))
	source.setRead('balanceOfPortfolioRecoveryRights', [3n * unit, 5n * unit, unit])
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Recovery transfer prerequisites changed')
	expect(requests).toHaveLength(1)
})
test('recovery transfer blocks invalid recipients, zero amounts, per-outcome overdrafts and missing source preparation', async () => {
	const { hook, source, requests } = await recoverySetup()
	await act(() => hook.state().setRecipient(owner))
	expect(hook.state().transferReason).toContain('another nonzero')
	await act(() => hook.state().setRecipient(zeroAddress))
	expect(hook.state().transferReason).toContain('another nonzero')
	await act(() => hook.state().setRecipient(capital))
	expect(hook.state().transferReason).toContain('at least one')
	await act(() => hook.state().setInvalidRights('4'))
	expect(hook.state().transferReason).toContain('Insufficient recovery rights')
	await expect(hook.state().transfer()).rejects.toThrow('Insufficient recovery rights')
	expect(requests).toHaveLength(0)
	await act(() => hook.state().setInvalidRights('-1'))
	expect(hook.state().transferReason).toContain('nonnegative')
	await act(() => hook.state().setInvalidRights('1'))
	source.setRead('getSecurityPool', zeroAddress)
	await act(() => hook.state().setQuestion('8'))
	await waitFor(() => expect(hook.state().recovery?.pool).toBe(zeroAddress))
	expect(hook.state().transferReason).toBe('Prepare the source question first.')
})
test('received recovery sets can be redeemed independently of source balances and preserve exact review context', async () => {
	const { hook, source, snapshot, requests } = await recoverySetup()
	source.setSnapshot({ ...snapshot, timestamp: 2_000n })
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'33'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.timestamp).toBe(2_000n))
	await waitFor(() => expect(hook.state().recovery?.availableShares).toBe(3n * unit))
	await act(() => hook.state().setShares('3'))
	expect(hook.state().recoverReason).toBeUndefined()
	await act(() => hook.state().recover())
	const request = requests[0]
	if (request === undefined) throw new Error('Recovery request missing')
	expect(decodeFunctionData({ abi: parseAbi(['function recoverUnchosenCash(uint248 source,uint256 questionId,uint256 shares) returns (uint256)']), data: request.data })).toEqual({ functionName: 'recoverUnchosenCash', args: [0n, 7n, 3n * unit] })
	expect(request.reviewDescription).toContain('Received recovery rights are consumed first')
	await request.validateBeforeSubmit?.()
	source.setRead('balanceOfPortfolioRecoveryRights', [2n * unit, 5n * unit, 4n * unit])
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Source recovery prerequisites changed')
})

test('finalized questions keep ordinary redemption and cannot detach source recovery rights', async () => {
	const { hook, source, requests } = await recoverySetup()
	await act(() => {
		hook.state().setRecipient(capital)
		hook.state().setInvalidRights('1')
	})
	await act(() => hook.state().transfer())
	const request = requests[0]
	if (request === undefined) throw new Error('Recovery transfer request missing')
	source.setRead('isPortfolioRecoveryEligible', false)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Recovery transfer prerequisites changed')
	await act(() => hook.state().setQuestion('8'))
	await waitFor(() => expect(hook.state().transferReason).toContain('Redeem finalized shares'))
	expect(hook.state().recoverReason).toContain('Redeem finalized shares')
	await expect(hook.state().transfer()).rejects.toThrow('Redeem finalized shares')
	expect(requests).toHaveLength(1)
})
