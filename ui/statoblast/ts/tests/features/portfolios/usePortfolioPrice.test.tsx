import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { usePortfolioPrice, type PortfolioPriceParameters } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioPrice.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalSnapshot, token, unit } from './capitalFixture.js'
import { priceFixture, priceFeed, priceWeth } from './priceFixture.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const abi = parseAbi([
	'function preparePortfolioPriceFeed(address source,uint248 universeId) returns (address)',
	'function requestPortfolioPrice(uint256 proposedRepPerEthPrice,uint256 requestedInitialAttoWeth,uint256 bountyAttoEth) payable returns (uint256)',
	'function approve(address spender,uint256 amount) returns (bool)',
	'function deposit() payable',
])
async function setup(configure: (fixture: ReturnType<typeof priceFixture>) => void = () => undefined) {
	const fixture = priceFixture()
	configure(fixture)
	const fork = await fixture.fork()
	const requests: PortfolioTransaction[] = []
	const labels: string[] = []
	const actions: PortfolioPriceParameters['actions'] = {
		scope: unscopedTransaction,
		busy: undefined,
		ownerReason: undefined,
		runPortfolioAction: async (_a, label, build) => {
			labels.push(label)
			requests.push(await build())
		},
	}
	const parameters: PortfolioPriceParameters = { fork, actions }
	const hook = await renderHookWithProps(usePortfolioPrice, parameters)
	lifecycle.trackRendered(hook)
	await waitFor(() => expect(hook.state().loading).toBe(false))
	return { ...fixture, fork, actions, requests, labels, hook }
}
function lastRequest(requests: PortfolioTransaction[]) {
	const request = requests.at(-1)
	if (request === undefined) throw new Error('Missing transaction')
	return request
}
test('price preparation blocks before start and creates only one explicit preparation transaction', async () => {
	const state = await setup(f => {
		f.values['priceFeed'] = zeroAddress
		f.values['sharedPriceFeeds'] = zeroAddress
		f.values['isPriceReportingOpen'] = false
	})
	expect(state.hook.state().prepareReason).toBeUndefined()
	await act(() => state.hook.state().prepare())
	expect(state.requests).toHaveLength(1)
	expect(decodeFunctionData({ abi, data: lastRequest(state.requests).data })).toEqual({ functionName: 'preparePortfolioPriceFeed', args: [token, 42n] })
	const branch = state.fork.branch
	if (branch === undefined) throw new Error('Missing branch')
	await state.hook.setProps({ fork: { ...state.fork, branch: { ...branch, started: false } } })
	expect(state.hook.state().prepareReason).toContain('Prepare the branch')
	await expect(state.hook.state().prepare()).rejects.toThrow('Prepare the branch')
	expect(state.requests).toHaveLength(1)
})
test('wrapping and editable approvals remain independent from requesting a funded report', async () => {
	const state = await setup()
	await act(() => state.hook.state().setPrice('2'))
	expect(state.hook.state().wrapReason).toBeUndefined()
	expect(state.hook.state().requestReason).toContain('Wrap')
	await act(() => state.hook.state().wrap())
	expect(state.requests).toHaveLength(1)
	expect(lastRequest(state.requests)).toMatchObject({ to: priceWeth, value: 2n * unit })
	await lastRequest(state.requests).validateBeforeSubmit?.()
	state.setWeth(2n * unit)
	await act(() => state.hook.state().refresh())
	await waitFor(() => expect(state.hook.state().funding?.wrap).toBe(0n))
	expect(state.hook.state().requestReason).toContain('Approve both')
	await act(() => state.hook.state().approve('weth', 9n * unit))
	expect(state.requests).toHaveLength(2)
	expect(decodeFunctionData({ abi, data: lastRequest(state.requests).data })).toEqual({ functionName: 'approve', args: [priceFeed, 9n * unit] })
	await act(() => state.hook.state().approve('rep', 8n * unit))
	expect(state.requests).toHaveLength(3)
	state.setAllowances(9n * unit, 8n * unit)
	await act(() => state.hook.state().refresh())
	await waitFor(() => expect(state.hook.state().requestReason).toBeUndefined())
	await act(() => state.hook.state().request())
	expect(state.requests).toHaveLength(4)
	const request = lastRequest(state.requests)
	expect(request.reviewDescription).toContain('Disputes may change')
	expect(request.value).toBe(101n)
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'requestPortfolioPrice', args: [2n * unit, 2n * unit, 101n] })
	await request.validateBeforeSubmit?.()
	state.setAllowances(0n, 0n)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Approve both')
	expect(state.requests).toHaveLength(4)
})
test('fresh approval checks reject changed identities, report sizing and closed deadlines', async () => {
	const state = await setup()
	await act(() => state.hook.state().setPrice('2'))
	await act(() => state.hook.state().approve('rep', 4n * unit))
	const request = lastRequest(state.requests)
	state.values['minimumToken1ReportAttoEth'] = 3n * unit
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('funding changed')
	state.values['minimumToken1ReportAttoEth'] = 2n * unit
	state.values['isPriceReportingOpen'] = false
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('closed')
	state.values['isPriceReportingOpen'] = true
	state.values['reputationToken'] = priceWeth
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('another portfolio or branch')
})
test('persistent older report selection survives pending-report and transient snapshot reloads', async () => {
	const state = await setup()
	await act(() => {
		state.hook.state().setPrice('2')
		state.hook.state().setReportId('9')
	})
	await waitFor(() => expect(state.hook.state().report?.reportId).toBe(9n))
	state.values['pendingReportId'] = 12n
	await state.hook.setProps({ fork: undefined })
	expect(state.hook.state()).toMatchObject({ priceInput: '2', reportInput: '9' })
	await state.hook.setProps({ fork: state.fork })
	await waitFor(() => expect(state.hook.state().report?.reportId).toBe(9n))
	await state.hook.setProps({ fork: { ...state.fork, owner: token } })
	expect(state.hook.state()).toMatchObject({ priceInput: '', reportInput: '' })
})
test('settlement and recovery remain independent after funding closes', async () => {
	const state = await setup(f => {
		f.values['isPriceReportingOpen'] = false
		f.values['pendingReportId'] = 9n
		f.source.setSnapshot(capitalSnapshot({ timestamp: 4_000n }))
	})
	await waitFor(() => expect(state.hook.state().report?.reportId).toBe(9n))
	await act(() => state.hook.state().setPrice('2'))
	expect(state.hook.state().fundingReadError).toBeUndefined()
	expect(state.hook.state().requestReason).toContain('closed')
	expect(state.hook.state().settleReason).toBeUndefined()
	await act(() => state.hook.state().settle())
	expect(lastRequest(state.requests).gas).toBeGreaterThan(1_000_000n)
	await lastRequest(state.requests).validateBeforeSubmit?.()
	state.game.settlementTimestamp = 4_000n
	await act(() => state.hook.state().refresh())
	await waitFor(() => expect(state.hook.state().recoverReason).toBeUndefined())
	await act(() => state.hook.state().recover())
	await lastRequest(state.requests).validateBeforeSubmit?.()
	state.values['reportOutcome'] = 2n
	await act(() => state.hook.state().refresh())
	await waitFor(() => expect(state.hook.state().recoverReason).toContain('already complete'))
	expect(state.hook.state().withdrawReason).toBeUndefined()
	await act(() => state.hook.state().withdraw())
	expect(state.requests).toHaveLength(3)
})

test('new report funding stops one challenge period before the fixed preparation cutoff', async () => {
	const state = await setup()
	await act(() => state.hook.state().setPrice('2'))
	await act(() => state.hook.state().approve('rep', 4n * unit))
	const request = lastRequest(state.requests)
	state.source.setSnapshot(capitalSnapshot({ timestamp: 2_700n }))
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Too little time')
	await act(() => state.hook.state().refresh())
	await waitFor(() => expect(state.hook.state().snapshot?.timestamp).toBe(2_700n))
	expect(state.hook.state().requestReason).toContain('Too little time')
	expect(state.hook.state().fundingReason).toContain('Too little time')
})

test.each(['weth', 'rep'] as const)('the %s approval review names the exact selected allowance and branch feed spender', async tokenKind => {
	const state = await setup()
	await act(() => state.hook.state().setPrice('2'))
	const amount = 9_125_000_000_000_000_000n
	await act(() => state.hook.state().approve(tokenKind, amount))
	const request = lastRequest(state.requests)
	expect(state.labels.at(-1)).toBe(tokenKind === 'weth' ? 'Approve WETH for report' : 'Approve REP for report')
	expect(request.reviewDescription).toContain(tokenKind === 'weth' ? '9.125 WETH' : '9.125 branch REP')
	expect(request.reviewDescription).toContain(priceFeed)
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'approve', args: [priceFeed, amount] })
})

test('reports use the connected sponsor while an independent auction vault is selected', async () => {
	const state = await setup()
	await state.hook.setProps({ fork: { ...state.fork, owner: token }, bidder: state.fork.owner, actions: { ...state.actions, ownerReason: 'Activate the selected vault first.' } })
	await waitFor(() => expect(state.hook.state().loading).toBe(false))
	await act(() => state.hook.state().setPrice('2'))
	expect(state.hook.state().fundingReason).toBeUndefined()
	expect(state.hook.state().snapshot?.owner).toBe(state.fork.owner)
	await act(() => state.hook.state().approve('rep', 4n * unit))
	expect(lastRequest(state.requests).account).toBe(state.fork.owner)
})

test('a sponsor change during fresh price validation invalidates the reviewed action', async () => {
	const state = await setup()
	await act(() => state.hook.state().setPrice('2'))
	await act(() => state.hook.state().approve('rep', 4n * unit))
	const pending = createDeferred<bigint>()
	state.values['minimumToken1ReportAttoEth'] = pending.promise
	const validation = lastRequest(state.requests).validateBeforeSubmit?.()
	if (validation === undefined) throw new Error('Missing pre-submit validation')
	await state.hook.setProps({ bidder: token })
	pending.resolve(2n * unit)
	await expect(validation).rejects.toThrow('wallet environment changed')
})
