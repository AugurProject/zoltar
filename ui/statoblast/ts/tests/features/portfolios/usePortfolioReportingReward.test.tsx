import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { usePortfolioReportingReward } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioReportingReward.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalSnapshot, token, capital, owner, unit } from './capitalFixture.js'
import { capitalClient, modules } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
async function setup(overrides: Record<string, unknown> = {}) {
	const snapshot = capitalSnapshot()
	const source = capitalClient(snapshot)
	const values: Record<string, unknown> = {
		getPool: token,
		registeredPools: true,
		settlement: modules.engine,
		services: capital,
		securityPoolForker: modules.fork,
		ledger: modules.book,
		bookIds: 1n,
		getQuestionOutcome: 1n,
		question: [{ units: unit, outcomeSupplyAttoShares: 10n * unit, finalAfter: 900, feeRateAttoEthPerSecond: 0n, feeStart: 0, feeEnd: 0, feePrincipalAttoEth: 0n, rewardShares: unit }, 0n],
		quoteReportingReward: [owner, unit],
		quoteQuestionRecoveryRep: 2n * unit,
		...overrides,
	}
	const client = source.client.extend(() =>
		createMockReadClient(async request => {
			if (request.functionName in values) return values[request.functionName]
			return source.client.readContract(request)
		}),
	)
	installActiveEnvironmentForTesting({ ...source.backend, createReadClient: () => client })
	const requests: PortfolioTransaction[] = []
	const actions = {
		runPortfolioAction: async (_action: string, _label: string, build: () => PortfolioTransaction | Promise<PortfolioTransaction>) => {
			requests.push(await build())
		},
	}
	const parameters: Parameters<typeof usePortfolioReportingReward>[0] = { model: { snapshot, setup: undefined, loading: false, discovering: false, error: undefined, managerInput: snapshot.portfolio }, actions, accountAddress: token, questionInput: '1' }
	const hook = await renderHookWithProps(usePortfolioReportingReward, parameters)
	lifecycle.trackRendered(hook)
	await waitFor(() => expect(hook.state().loading).toBe(false))
	return { hook, requests, values, source, snapshot, model: parameters.model }
}

test.each([
	['discovery', { discovering: true, managerInput: '' }, true, 'Loading portfolio details…'],
	['account read', { loading: true }, true, 'Loading portfolio details…'],
	['empty selection', { managerInput: '' }, false, 'Enter a portfolio address above.'],
	['failed discovery', { error: 'Unable to discover the portfolio.', managerInput: '' }, false, 'Unable to discover the portfolio.'],
	['failed account read', { error: 'Portfolio RPC unavailable.' }, false, 'Portfolio RPC unavailable.'],
])('reporting reward distinguishes portfolio %s', async (_state, overrides, loading, reason) => {
	const { hook, model, requests } = await setup()
	await hook.setProps({ model: { ...model, snapshot: undefined, ...overrides } })
	expect(hook.state().loading).toBe(loading)
	expect(hook.state().reason).toBe(reason)
	expect(hook.state().reward).toBeUndefined()
	await expect(hook.state().claim()).rejects.toThrow(reason)
	expect(requests).toHaveLength(0)
})
test.each([1, 3])('reporting reward directs incomplete setup stage %s to preparation without claiming it is loading', async stage => {
	const { hook, model, snapshot } = await setup()
	await hook.setProps({ model: { ...model, snapshot: undefined, setup: { ...snapshot, stage } } })
	expect(hook.state().loading).toBe(false)
	expect(hook.state().reason).toBe('Complete the portfolio setup above.')
})

test('any connected caller can claim once for the fixed winning reporter with a capped ETH payout and REP burn preview', async () => {
	const { hook, requests, values } = await setup()
	expect(hook.state().reason).toBeUndefined()
	expect(hook.state().reward?.beneficiary).toBe(owner)
	await act(() => hook.state().claim())
	const request = requests[0]
	if (request === undefined) throw new Error('Reward claim request missing')
	expect(request.account).toBe(token)
	expect(request.value).toBe(0n)
	expect(decodeFunctionData({ abi: parseAbi(['function claimQuestionReportingReward(address pool)']), data: request.data })).toEqual({ functionName: 'claimQuestionReportingReward', args: [token] })
	expect(request.reviewDescription).toContain(`1 ETH for question`)
	expect(request.reviewDescription).toContain(`fixed recipient ${owner}`)
	await request.validateBeforeSubmit?.()
	values['quoteReportingReward'] = [owner, 0n]
	values['quoteQuestionRecoveryRep'] = 0n
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Reporting reward changed')
})
test('the preview uses the capped canonical payout rather than the entire funded question reserve', async () => {
	const { hook, requests } = await setup({ quoteReportingReward: [owner, unit / 10n] })
	expect(hook.state().reward?.cashAttoEth).toBe(unit / 10n)
	await act(() => hook.state().claim())
	expect(requests[0]?.reviewDescription).toContain('Release 0.1 ETH')
	expect(requests[0]?.reviewDescription).toContain('2 REP will be burned')
	expect(requests[0]?.reviewDescription).toContain('remaining budget funds pool maintenance')
})
test.each([
	[{ getQuestionOutcome: 3n }, 'must be final'],
	[{ quoteReportingReward: [zeroAddress, 0n] }, 'beneficiary is unavailable'],
	[{ quoteReportingReward: [owner, 0n], quoteQuestionRecoveryRep: 0n }, 'No funded'],
	[{ registeredPools: false }, 'Register or prepare'],
])('rejects a claim when finality or funding is missing', async (overrides, expected) => {
	const { hook, requests } = await setup(overrides)
	expect(hook.state().reason).toContain(expected)
	await expect(hook.state().claim()).rejects.toThrow(expected)
	expect(requests).toHaveLength(0)
})
test('unassigned reporting budgets route to maintenance with explicit REP burn disclosure', async () => {
	const { hook, requests } = await setup({ quoteReportingReward: [capital, unit] })
	expect(hook.state().reward?.beneficiary).toBe(capital)
	expect(hook.state().reason).toBeUndefined()
	await act(() => hook.state().claim())
	expect(requests[0]?.reviewDescription).toContain('funds pool maintenance; recovered REP is burned')
})
test('beneficiary changes and inherited source-only rewards cannot pass submission revalidation', async () => {
	const { hook, requests, values, snapshot, model } = await setup()
	await act(() => hook.state().claim())
	values['quoteReportingReward'] = [token, unit]
	await expect(requests[0]?.validateBeforeSubmit?.()).rejects.toThrow('Reporting reward changed')
	values['question'] = [{ rewardShares: unit }, 9n]
	values['frozenBooks'] = [unit, unit, 2n, 0n]
	await hook.setProps({ model: { ...model, snapshot: { ...snapshot, blockHash: snapshot.blockHash } }, questionInput: '2' })
	await waitFor(() => expect(hook.state().reason).toContain('source universe'))
})
