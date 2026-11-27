import { expect, spyOn, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { currentStateCheckFailed } from '@zoltar/ui-core-shared/copy/transaction.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { useSecurityPoolAuction, type SecurityPoolAuctionParameters } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolAuction.js'
import type { SecurityPoolTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capital, owner, token, unit } from './capitalFixture.js'
import { auctionFixture, auctionAddress } from './auctionFixture.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const abi = parseAbi(['function open()', 'function submitBid(uint256 lots,uint256 minimumAttoRepPerLot) returns (uint256)', 'function materializeRepairAuctionBids(uint256[] bidIds) returns (uint96[])', 'function refundBid(uint256 bidId,address recipient) returns (uint256)'])
async function setup(configure: (fixture: Awaited<ReturnType<typeof auctionFixture>>) => void = () => undefined) {
	const fixture = await auctionFixture()
	configure(fixture)
	const requests: SecurityPoolTransaction[] = []
	const labels: string[] = []
	const actions: SecurityPoolAuctionParameters['actions'] = {
		scope: unscopedTransaction,
		busy: undefined,
		ownerReason: undefined,
		runSecurityPoolAction: async (_action, label, build) => {
			labels.push(label)
			requests.push(await build())
		},
	}
	const hook = await renderHookWithProps(useSecurityPoolAuction, { fork: fixture.fork, bidder: owner, actions })
	lifecycle.trackRendered(hook)
	await waitFor(() => expect(hook.state().loading).toBe(false))
	if (hook.state().error !== undefined) throw new Error(hook.state().error)
	return { ...fixture, hook, requests, labels, actions }
}
/** The snapshot's first auction bid; `description` names it when it is missing. */
function firstBid(state: Awaited<ReturnType<typeof setup>>, description: string) {
	const bid = state.hook.state().snapshot?.auction?.bids[0]
	if (bid === undefined) throw new Error(`Missing ${description}`)
	return bid
}

function last<T>(requests: T[]) {
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

test('auction bidding sends only the reviewed collateral bid without REP approval or a separate reserve', async () => {
	const state = await setup()
	state.setAllowances(100n * unit, 0n)
	await terms(state)
	expect(state.hook.state().quote).toMatchObject({ bidAttoEth: 2n * unit, minimumPrincipalAttoRep: 10n * unit })
	expect(state.hook.state().quote).not.toHaveProperty('topUpAttoRep')
	expect(state.hook.state()).toHaveProperty('approve')
	expect(state.hook.state()).not.toHaveProperty('setReserve')
	expect(state.hook.state().bidReason).toBeUndefined()
	await act(() => state.hook.state().bid())
	expect(state.requests).toHaveLength(1)
	expect(last(state.requests)).toMatchObject({ account: owner, to: auctionAddress, value: 0n })
	expect(decodeFunctionData({ abi, data: last(state.requests).data })).toEqual({ functionName: 'submitBid', args: [2n, 5n * unit] })
	expect(last(state.requests).reviewDescription).toContain('claim the bid to add them to your position')
	await last(state.requests).validateBeforeSubmit?.()
	expect(last(state.requests).readReviewRows?.()).toContainEqual({ label: 'Number of lots', value: '0 → 2' })
	state.values['lotAttoEth'] = 2n * unit
	state.values['targetLots'] = 5n
	await expect(last(state.requests).validateBeforeSubmit?.()).rejects.toThrow()
	expect(state.requests).toHaveLength(1)
})

test('a visited bid page stays readable after remount when the auction RPC fails', async () => {
	const state = await setup()
	const bid = firstBid(state, 'verified bid')
	const failed = state.client.extend(() => ({
		getBlock: async () => {
			throw new Error('RPC unavailable')
		},
	}))
	installActiveEnvironmentForTesting({ ...state.backend, createReadClient: () => failed })
	const restored = await renderHookWithProps(useSecurityPoolAuction, { fork: state.fork, bidder: owner, actions: state.actions })
	lifecycle.trackRendered(restored)
	await waitFor(() => expect(restored.state().error).toContain('RPC unavailable'))
	expect(restored.state().snapshot?.auction?.bids[0]).toEqual(bid)
	expect(restored.state().refundReason(bid)).toContain('RPC unavailable')
	await expect(restored.state().refund(bid)).rejects.toThrow('RPC unavailable')
	expect(state.requests).toHaveLength(0)
	const child = state.fork.branch
	if (child === undefined) throw new Error('Missing branch')
	await restored.setProps({ fork: undefined, savedBranch: { securityPool: state.fork.securityPool, universeId: child.universeId } })
	expect(restored.state().snapshot?.auction?.bids[0]).toEqual(bid)
	expect(restored.state().refundReason(bid)).toContain('Select a fork branch')
	await restored.setProps({ savedBranch: { securityPool: state.fork.securityPool, universeId: child.universeId + 1n } })
	expect(restored.state().snapshot).toBeUndefined()
})

test('successive auction reads can take longer than one request timeout', async () => {
	const shortened = new Proxy(globalThis.setTimeout, {
		apply(schedule, receiver, [handler, delay, ...args]) {
			return Reflect.apply(schedule, receiver, [handler, delay === 15_000 ? 160 : delay, ...args])
		},
	})
	const timer = spyOn(globalThis, 'setTimeout').mockImplementation(shortened)
	try {
		const state = await setup(fixture => {
			const slow = fixture.client.extend(() => ({
				getBlock: async (...args: Parameters<typeof fixture.client.getBlock>) => {
					await Bun.sleep(100)
					return await fixture.client.getBlock(...args)
				},
			}))
			installActiveEnvironmentForTesting({ ...fixture.backend, createReadClient: () => slow })
		})
		expect(firstBid(state, 'bid read through slow RPC').id).toBe(1n)
	} finally {
		timer.mockRestore()
	}
})

test('a timed-out bid check uses the review retry message and recalculates on retry', async () => {
	const stalled = createDeferred<void>()
	let delay = false
	const state = await setup(fixture => {
		const client = fixture.client.extend(() => ({
			getBlock: async (...args: Parameters<typeof fixture.client.getBlock>) => {
				if (delay) await stalled.promise
				return await fixture.client.getBlock(...args)
			},
		}))
		installActiveEnvironmentForTesting({ ...fixture.backend, createReadClient: () => client })
	})
	await terms(state)
	await act(() => state.hook.state().bid())
	const request = last(state.requests)
	const shortened = new Proxy(globalThis.setTimeout, {
		apply(schedule, receiver, [handler, timeout, ...args]) {
			return Reflect.apply(schedule, receiver, [handler, timeout === 15_000 ? 20 : timeout, ...args])
		},
	})
	const timer = spyOn(globalThis, 'setTimeout').mockImplementation(shortened)
	try {
		delay = true
		await expect(request.validateBeforeSubmit?.()).rejects.toThrow(currentStateCheckFailed)
		delay = false
		await request.validateBeforeSubmit?.()
		expect(request.readReviewRows?.()).toContainEqual({ label: 'Number of lots', value: '0 → 2' })
	} finally {
		timer.mockRestore()
		stalled.resolve()
	}
})

test('collateral floor, integer lots and price grid are checked before sending, with no bid health target', async () => {
	const state = await setup()
	expect(state.hook.state()).not.toHaveProperty('setHealth')
	expect(state.hook.state()).not.toHaveProperty('healthInput')
	await terms(state)
	await act(() => state.hook.state().setRep('3'))
	expect(state.hook.state().bidReason).toContain('at least 4 REP to back each lot')
	await act(() => {
		state.hook.state().setRep('5')
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

test('a bidder with many bids can still bid', async () => {
	const state = await setup(fixture => {
		fixture.values['bidderBidCount'] = 8n
	})
	expect(state.hook.state().snapshot?.auction).not.toHaveProperty('maximumBidsPerBidder')
	await terms(state)
	expect(state.hook.state().bidReason).toBeUndefined()
})

test('winners expose live principal and fees until their bid is claimed', async () => {
	const state = await setup(fixture => {
		fixture.values['finalized'] = true
	})
	const bid = firstBid(state, 'auction bid')
	expect(bid).toMatchObject({ claimable: true, claimed: false })
	expect(bid.position).toMatchObject({ principalAttoRep: 100n * unit, commitmentAttoEth: unit, earnedAttoEth: 7n * unit, earnedAttoRep: 9n * unit })
	expect(bid.materialized).toBe(false)
	expect(state.hook.state().bidClaimReason(bid)).toBeUndefined()
	await act(() => state.hook.state().claimBid(bid))
	expect(state.requests).toHaveLength(1)
	expect(last(state.requests)).toMatchObject({ account: owner, to: capital, value: 0n })
	expect(decodeFunctionData({ abi, data: last(state.requests).data })).toEqual({ functionName: 'materializeRepairAuctionBids', args: [[1n]] })
	expect(state.labels.at(-1)).toBe('Claim bid')
	expect(last(state.requests).reviewDescription).toContain('Its winning lots join this wallet’s position')
	await last(state.requests).validateBeforeSubmit?.()
	state.values['bids'] = [owner, false, true, 2n, 60n * unit]
	state.values['repairAuctionPositions'] = [[owner, 100n * unit, unit, 0n, true, 0n, 0n]]
	await expect(last(state.requests).validateBeforeSubmit?.()).rejects.toThrow('This bid is claimed.')
	await act(() => state.hook.state().refresh())
	await waitFor(() => expect(state.hook.state().snapshot?.auction?.bids[0]?.claimed).toBe(true))
	expect(state.hook.state().bidClaimReason(firstBid(state, 'claimed bid'))).toBe('This bid is claimed.')
})

test('claiming all bids sends every claimable bid in one transaction, losing bids included', async () => {
	const state = await setup(fixture => {
		fixture.values['finalized'] = true
		fixture.values['previewBid'] = [owner, 0n, 0n, 0n, 2n * unit]
		fixture.values['repairAuctionPositions'] = [[owner, 0n, 0n, 0n, false, 0n, 0n]]
	})
	expect(firstBid(state, 'losing bid')).toMatchObject({ claimable: true, claimed: false, position: undefined })
	expect(state.hook.state().claimableBidIds).toEqual([1n])
	expect(state.hook.state().claimAllReason).toBeUndefined()
	await act(() => state.hook.state().claimAllBids())
	expect(decodeFunctionData({ abi, data: last(state.requests).data })).toEqual({ functionName: 'materializeRepairAuctionBids', args: [[1n]] })
	expect(state.labels.at(-1)).toBe('Claim all bids')
	await last(state.requests).validateBeforeSubmit?.()
	// Someone else claimed it meanwhile: nothing is left to send.
	state.values['repairAuctionPositions'] = [[owner, 0n, 0n, 0n, true, 0n, 0n]]
	state.values['unclaimedRepairAuctionBids'] = 0n
	await expect(last(state.requests).validateBeforeSubmit?.()).rejects.toThrow('No bids')
	await act(() => state.hook.state().refresh())
	await waitFor(() => expect(state.hook.state().claimAllReason).toBe('All your bids are claimed.'))
})

test('claiming all bids while the branch imports capital gives the import reason without the bid-funding prefix', async () => {
	const state = await setup(fixture => {
		fixture.values['finalized'] = true
		fixture.values['importing'] = true
	})
	expect(state.hook.state().claimableBidIds).toEqual([1n])
	expect(state.hook.state().claimAllReason).toBe('Bids can be claimed after the branch finishes importing capital.')
})

test('bids cannot be claimed while they may still win', async () => {
	const state = await setup()
	const bid = firstBid(state, 'open bid')
	expect(bid).toMatchObject({ claimable: false, claimed: false })
	expect(state.hook.state().bidClaimReason(bid)).toBe('This bid can be claimed after the auction closes.')
	expect(state.hook.state().claimAllReason).toBe('Bids can be claimed after the auction closes.')
	await expect(state.hook.state().claimAllBids()).rejects.toThrow('after the auction closes')
	expect(state.requests).toHaveLength(0)
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

test('an early refund pays only the bid’s own collateral to its bidder and revalidates eligibility', async () => {
	const state = await setup(fixture => {
		fixture.values['earlyRefundAttoEth'] = 2n * unit
	})
	const bid = firstBid(state, 'auction bid')
	expect(state.hook.state().refundReason(bid)).toBeUndefined()
	await act(() => state.hook.state().refund(bid))
	expect(state.requests).toHaveLength(1)
	expect(state.labels).toEqual(['Withdraw this bid’s refund'])
	expect(last(state.requests)).toMatchObject({ account: owner, to: auctionAddress, value: 0n })
	expect(decodeFunctionData({ abi, data: last(state.requests).data })).toEqual({ functionName: 'refundBid', args: [1n, owner] })
	expect(last(state.requests).reviewDescription).toBe('Withdraw this bid’s 2 WETH of unused collateral to your wallet.')
	await last(state.requests).validateBeforeSubmit?.()
	state.values['earlyRefundAttoEth'] = 0n
	await expect(last(state.requests).validateBeforeSubmit?.()).rejects.toThrow('may still win')
})

test('a refund stays unavailable while the bid may still win', async () => {
	const state = await setup()
	const bid = firstBid(state, 'auction bid')
	expect(state.hook.state().refundReason(bid)).toBe('This bid may still win. Its collateral remains committed until closing.')
	await expect(state.hook.state().refund(bid)).rejects.toThrow('may still win')
	expect(state.requests).toHaveLength(0)
})

test('a refunded bid cannot be refunded again', async () => {
	const state = await setup(fixture => {
		fixture.values['earlyRefundAttoEth'] = 2n * unit
	})
	const bid = firstBid(state, 'auction bid')
	await act(() => state.hook.state().refund(bid))
	state.values['bids'] = [owner, true, false, 2n, 60n * unit]
	await expect(last(state.requests).validateBeforeSubmit?.()).rejects.toThrow('already refunded')
	await act(() => state.hook.state().refresh())
	await waitFor(() => expect(state.hook.state().snapshot?.auction?.bids[0]?.refundSettled).toBe(true))
	const settled = firstBid(state, 'settled bid')
	expect(state.hook.state().refundReason(settled)).toBe('This bid’s unused collateral was already refunded.')
})

test('an auction disappearing before approval submission invalidates the request', async () => {
	const state = await setup()
	await terms(state)
	await act(() => state.hook.state().approve(2n * unit))
	const request = last(state.requests)
	state.values['repairAuctions'] = zeroAddress
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow()
})

test('#1371 excluded limits block collateral approval before a transaction is built', async () => {
	const state = await setup(fixture => {
		fixture.values['maximumAdmissibleBidAttoRepPerLot'] = 4n * unit
	})
	await terms(state)
	expect(state.hook.state().quote).toBeUndefined()
	expect(state.hook.state().fundingReason).toContain('Better funded bids')
	await expect(state.hook.state().approve(2n * unit)).rejects.toThrow('Better funded bids')
	expect(state.requests).toHaveLength(0)
})

test('#1371 a repriced book invalidates collateral approval before submission', async () => {
	const state = await setup()
	await terms(state)
	await act(() => state.hook.state().approve(2n * unit))
	const request = last(state.requests)
	state.values['maximumAdmissibleBidAttoRepPerLot'] = 4n * unit
	if (request.validateBeforeSubmit === undefined) throw new Error('Approval validation missing')
	await expect(request.validateBeforeSubmit()).rejects.toThrow('Better funded bids')
})
