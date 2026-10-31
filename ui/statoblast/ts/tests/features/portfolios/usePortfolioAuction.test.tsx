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
	'function submitBid(uint256 lots,uint256 minimumAttoRepPerLot,uint256 targetHealthFactorBps) payable returns (uint256,address)',
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
		state.hook.state().setRep('5')
	})
}

test('auction bidding sends only the reviewed ETH bid without REP approval or a separate reserve', async () => {
	const state = await setup()
	state.setAllowances(0n, 0n)
	await terms(state)
	expect(state.hook.state().quote).toMatchObject({ bidAttoEth: 2n * unit, minimumPrincipalAttoRep: 10n * unit })
	expect(state.hook.state().quote).not.toHaveProperty('topUpAttoRep')
	expect(state.hook.state()).not.toHaveProperty('approve')
	expect(state.hook.state()).not.toHaveProperty('setReserve')
	expect(state.hook.state().bidReason).toBeUndefined()
	await act(() => state.hook.state().bid())
	expect(state.requests).toHaveLength(1)
	expect(last(state.requests)).toMatchObject({ account: owner, to: auctionAddress, value: 2n * unit })
	expect(decodeFunctionData({ abi, data: last(state.requests).data })).toEqual({ functionName: 'submitBid', args: [2n, 5n * unit, 12_000n] })
	expect(last(state.requests).reviewDescription).toContain('Purchased REP backs')
	await last(state.requests).validateBeforeSubmit?.()
	state.values['lotAttoEth'] = 2n * unit
	state.values['targetLots'] = 5n
	await expect(last(state.requests).validateBeforeSubmit?.()).rejects.toThrow()
	expect(state.requests).toHaveLength(1)
})

test('chosen health, integer lots and price grid are checked before sending', async () => {
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
		state.hook.state().setRep('5')
	})
	expect(state.hook.state().bidReason).toBeUndefined()
	expect(state.requests).toHaveLength(0)
})

test('auction drafts survive transient fork reloads but reset when the bidder changes', async () => {
	const state = await setup()
	await terms(state)
	await state.hook.setProps({ fork: undefined })
	expect(state.hook.state()).toMatchObject({ lotsInput: '2', repInput: '5' })
	await state.hook.setProps({ fork: state.fork })
	await waitFor(() => expect(state.hook.state().loading).toBe(false))
	expect(state.hook.state()).toMatchObject({ lotsInput: '2', repInput: '5' })
	await state.hook.setProps({ bidder: token })
	expect(state.hook.state()).toMatchObject({ lotsInput: '', repInput: '' })
})

test('automatic winners expose live principal and fees before activating individual controls', async () => {
	const state = await setup(fixture => {
		fixture.values['finalized'] = true
	})
	const bid = state.hook.state().snapshot?.auction?.bids[0]
	if (bid === undefined) throw new Error('Missing auction bid')
	expect(bid.position).toMatchObject({ principalAttoRep: 100n * unit, commitmentAttoEth: unit, earnedAttoEth: 7n * unit, earnedAttoRep: 9n * unit, materialized: false })
	expect(state.hook.state().activateReason(bid)).toBeUndefined()
	await act(() => state.hook.state().activate(bid))
	expect(state.requests).toHaveLength(1)
	expect(last(state.requests)).toMatchObject({ account: owner, to: capital, value: 0n })
	expect(decodeFunctionData({ abi, data: last(state.requests).data })).toEqual({ functionName: 'materializeAuctionBid', args: [1n] })
	await last(state.requests).validateBeforeSubmit?.()
	state.values['bids'] = [owner, auctionVault, 12_000n, 2n, 60n * unit, false, true]
	state.values['auctionPosition'] = [auctionVault, 8n, 100n * unit, unit, 12_000n, 0n, true, 7n * unit, 9n * unit]
	await expect(last(state.requests).validateBeforeSubmit?.()).rejects.toThrow()
})

test('reviewed auction actions reject a context change during their fresh read', async () => {
	const state = await setup()
	await terms(state)
	await act(() => state.hook.state().bid())
	const pending = createDeferred<bigint>()
	state.values['repGrid'] = pending.promise
	const validation = last(state.requests).validateBeforeSubmit?.()
	if (validation === undefined) throw new Error('Missing pre-submit validation')
	await state.hook.setProps({ bidder: token })
	pending.resolve(2n)
	await expect(validation).rejects.toThrow('wallet or network changed')
})
