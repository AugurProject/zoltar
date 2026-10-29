import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { usePortfolioAuction, type PortfolioAuctionParameters } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioAuction.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capital, owner, token, unit } from './capitalFixture.js'
import { auctionFixture, auctionAddress, auctionVault } from './auctionFixture.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const abi = parseAbi([
	'function open()',
	'function approve(address spender,uint256 amount) returns (bool)',
	'function submitBid(uint256 lots,uint256 minimumAttoRepPerLot,uint256 targetHealthFactorBps,uint256 executionReservePerLotAttoEth) payable returns (uint256,address)',
	'function materializeAuctionBid(uint256 bidId) returns (address,uint96)',
	'function settleRefund(uint256 bidId)',
	'function withdrawRefunds(address recipient)',
])
async function setup(configure: (fixture: Awaited<ReturnType<typeof auctionFixture>>) => void = () => undefined) {
	const fixture = await auctionFixture()
	configure(fixture)
	const requests: PortfolioTransaction[] = []
	const labels: string[] = []
	const actions: PortfolioAuctionParameters['actions'] = {
		scope: unscopedTransaction,
		busy: undefined,
		ownerReason: undefined,
		runPortfolioAction: async (_action, label, build) => {
			labels.push(label)
			requests.push(await build())
		},
	}
	const hook = await renderHookWithProps(usePortfolioAuction, { fork: fixture.fork, bidder: owner, actions })
	lifecycle.trackRendered(hook)
	await waitFor(() => expect(hook.state().loading).toBe(false))
	if (hook.state().error !== undefined) throw new Error(hook.state().error)
	return { ...fixture, hook, requests, labels, actions }
}
function last(requests: PortfolioTransaction[]) {
	const request = requests.at(-1)
	if (request === undefined) throw new Error('Missing auction transaction')
	return request
}
async function terms(state: Awaited<ReturnType<typeof setup>>) {
	await act(() => {
		state.hook.state().setLots('2')
		state.hook.state().setRep('1')
	})
}

test('auction REP approval and funding are independent with exact reviewed budgets', async () => {
	const state = await setup()
	await terms(state)
	expect(state.hook.state().quote).toMatchObject({ bidAttoEth: 2n * unit, topUpAttoRep: 8n * unit, executionReserveAttoEth: unit / 50n, totalAttoEth: (202n * unit) / 100n })
	expect(state.hook.state().bidReason).toContain('Approve')
	await act(() => state.hook.state().approve(9n * unit))
	expect(state.requests).toHaveLength(1)
	expect(decodeFunctionData({ abi, data: last(state.requests).data })).toEqual({ functionName: 'approve', args: [auctionAddress, 9n * unit] })
	expect(last(state.requests).reviewDescription).toContain('9 branch REP')
	await last(state.requests).validateBeforeSubmit?.()
	state.setAllowances(0n, 9n * unit)
	await act(() => state.hook.state().refresh())
	await waitFor(() => expect(state.hook.state().bidReason).toBeUndefined())
	await act(() => state.hook.state().bid())
	expect(state.requests).toHaveLength(2)
	expect(last(state.requests)).toMatchObject({ account: owner, to: auctionAddress, value: (202n * unit) / 100n })
	expect(decodeFunctionData({ abi, data: last(state.requests).data })).toEqual({ functionName: 'submitBid', args: [2n, unit, 12_000n, unit / 100n] })
	await last(state.requests).validateBeforeSubmit?.()
	state.values['minimumExecutionReservePerLot'] = unit / 50n
	await expect(last(state.requests).validateBeforeSubmit?.()).rejects.toThrow('Review the updated')
	expect(state.requests).toHaveLength(2)
})

test('chosen health, integer lots, price grid and explicit execution reserve are checked before sending', async () => {
	const state = await setup()
	await terms(state)
	await act(() => state.hook.state().setHealth('130'))
	expect(state.hook.state().bidReason).toContain('chosen health target')
	await act(() => state.hook.state().setHealth('120.001'))
	expect(state.hook.state().bidReason).toContain('two decimal')
	await act(() => {
		state.hook.state().setHealth('120')
		state.hook.state().setLots('0')
	})
	expect(state.hook.state().bidReason).toContain('whole number')
	await act(() => {
		state.hook.state().setLots('2')
		state.hook.state().setRep('0.000000000000000001')
	})
	expect(state.hook.state().bidReason).toContain('price-grid')
	await act(() => {
		state.hook.state().setRep('1')
		state.hook.state().setReserve('0')
	})
	expect(state.hook.state().bidReason).toContain('below the current minimum')
	expect(state.requests).toHaveLength(0)
})

test('auction drafts survive transient fork reloads but reset when the bidder changes', async () => {
	const state = await setup()
	await terms(state)
	await state.hook.setProps({ fork: undefined })
	expect(state.hook.state()).toMatchObject({ lotsInput: '2', repInput: '1' })
	await state.hook.setProps({ fork: state.fork })
	await waitFor(() => expect(state.hook.state().loading).toBe(false))
	expect(state.hook.state()).toMatchObject({ lotsInput: '2', repInput: '1' })
	await state.hook.setProps({ bidder: token })
	expect(state.hook.state()).toMatchObject({ lotsInput: '', repInput: '' })
})

test('automatic winners expose live principal and fees before activating individual controls', async () => {
	const state = await setup(fixture => {
		fixture.values['finalized'] = true
	})
	const bid = state.hook.state().snapshot?.auction?.bids[0]
	if (bid === undefined) throw new Error('Missing auction bid')
	expect(bid.position).toMatchObject({ principalAttoRep: 6n * unit, commitmentAttoEth: unit, earnedAttoEth: 7n * unit, earnedAttoRep: 9n * unit, materialized: false })
	expect(state.hook.state().activateReason(bid)).toBeUndefined()
	await act(() => state.hook.state().activate(bid))
	expect(state.requests).toHaveLength(1)
	expect(last(state.requests)).toMatchObject({ account: owner, to: capital, value: 0n })
	expect(decodeFunctionData({ abi, data: last(state.requests).data })).toEqual({ functionName: 'materializeAuctionBid', args: [1n] })
	await last(state.requests).validateBeforeSubmit?.()
	state.values['bids'] = [owner, auctionVault, 12_000n, 2n, unit, false, true]
	state.values['auctionPosition'] = [auctionVault, 8n, 6n * unit, unit, 12_000n, 0n, true, 7n * unit, 9n * unit]
	await expect(last(state.requests).validateBeforeSubmit?.()).rejects.toThrow()
})

test('reviewed auction actions reject a context change during their fresh read', async () => {
	const state = await setup()
	await terms(state)
	await act(() => state.hook.state().approve(9n * unit))
	const pending = createDeferred<bigint>()
	state.values['minimumExecutionReservePerLot'] = pending.promise
	const validation = last(state.requests).validateBeforeSubmit?.()
	if (validation === undefined) throw new Error('Missing pre-submit validation')
	await state.hook.setProps({ bidder: token })
	pending.resolve(unit / 100n)
	await expect(validation).rejects.toThrow('wallet or network changed')
})
