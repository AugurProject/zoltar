import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { SecurityPoolRepairAuction } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolRepairAuction.js'
import type { SecurityPoolAuctionParameters } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolAuction.js'
import { auctionFixture } from './auctionFixture.js'
import { capitalSnapshot, owner, unit } from './capitalFixture.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const actions: SecurityPoolAuctionParameters['actions'] = { scope: unscopedTransaction, busy: undefined, ownerReason: undefined, runSecurityPoolAction: async () => undefined }
function button(container: HTMLElement, text: string) {
	const found = Array.from(container.querySelectorAll('button')).find(node => node.textContent === text)
	if (found === undefined) throw new Error(`Missing ${text} button`)
	return found
}
function field(container: HTMLElement, text: string) {
	const found = Array.from(container.querySelectorAll('input')).find(node => node.closest('.field')?.querySelector('label')?.textContent === text)
	if (found === undefined) throw new Error(`Missing ${text} field`)
	return found
}
function metric(container: HTMLElement, text: string) {
	return Array.from(container.querySelectorAll('.metric-label'))
		.find(label => label.textContent === text)
		?.parentElement?.querySelector('.metric-field-value')?.textContent
}

test('the auction shows its recapitalization deadline, lot layout, and the current ask range', async () => {
	const fixture = await auctionFixture()
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolRepairAuction fork={{ ...fixture.fork, activationDeadline: 3_600n }} bidder={owner} actions={actions} />))
	await waitFor(() => expect(view.container.textContent).toContain('Bid 1'))
	expect(view.container.querySelector('time')?.dateTime).toBe('1970-01-01T01:00:00.000Z')
	expect(view.container.querySelector('[role="img"][aria-label*="10 lots"]')).not.toBeNull()
	const scale = view.container.querySelector('.statoblast-auction-ask-scale')
	expect(scale?.textContent).toContain('100% health')
	expect(scale?.textContent).toContain('4.00')
	expect(scale?.textContent).not.toContain('Your lowest')
	expect(scale?.textContent).toContain('Highest now')
})

test('an unaffordable default lot disables opening even when smaller lots would fit the inventory', async () => {
	const fixture = await auctionFixture()
	Object.assign(fixture.values, {
		opened: false,
		initialized: false,
		closesAt: 100_000n,
		shortfallAttoEth: 60n,
		minimumCommitmentAttoEth: 15n,
		lotAttoEth: 15n,
		targetLots: 4n,
		securityMultiplierBps: 10_500n,
		repGrid: 21n,
		conservativePrice: unit,
		inventoryAttoRep: 21n,
	})
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />))
	await waitFor(() => expect(view.container.textContent).toContain('The auction inventory cannot back one collateral lot at the minimum health target.'))
	const open = button(view.container, 'Open repair auction')
	expect(open.disabled).toBe(true)
	expect(open.getAttribute('aria-describedby')).toBeTruthy()
})

test('an auction deadline stops live bidding and rechecks the last observed block', async () => {
	const fixture = await auctionFixture()
	const nearDeadline = capitalSnapshot({ timestamp: 2_999n })
	fixture.source.setSnapshot(nearDeadline)
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />))
	await waitFor(() => expect(metric(view.container, 'Auction state')).toBe('Accepting bids'))
	const pending = createDeferred<bigint>()
	fixture.values['repGrid'] = pending.promise
	fixture.source.setSnapshot({ ...nearDeadline, timestamp: 3_000n })
	try {
		await waitFor(() => expect(metric(view.container, 'Auction state')).toBe('Ended · checking…'), { timeout: 3_000 })
		expect(view.container.querySelector('.statoblast-auction-ask-scale')).toBeNull()
		expect(button(view.container, 'Submit funded bid').disabled).toBe(true)
	} finally {
		fixture.values['repGrid'] = 2n
		await act(() => pending.resolve(2n))
	}
	await waitFor(() => expect(metric(view.container, 'Auction state')).toBe('Awaiting branch activation'))
	expect([...view.container.querySelectorAll('button')].some(node => node.textContent === 'Submit funded bid')).toBe(false)
	expect(view.container.querySelectorAll('input')).toHaveLength(0)
})

test('an open bid shows the lower-ask reason only when the verified limit proves strictly better bids', async () => {
	const fixture = await auctionFixture()
	fixture.values['maximumAdmissibleBidAttoRepPerLot'] = 50n * unit
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />))
	await waitFor(() => expect(view.container.textContent).toContain('In contention'))
	expect(view.container.textContent).not.toContain('Lower asks already fill the auction')
	fixture.values['earlyRefundAttoEth'] = 2n * unit
	await act(() => button(view.container, 'Refresh auction').click())
	await waitFor(() => expect(view.container.textContent).toContain('Lower asks already fill the auction'))
	expect(view.container.textContent).toContain('Outbid')
})

test('a finalized auction with no fills explains the remaining shortfall and makes bid collateral refundable', async () => {
	const fixture = await auctionFixture()
	fixture.values['finalized'] = true
	fixture.values['clearing'] = [0n, 0n, 0n, 0n, false]
	fixture.values['previewBid'] = [owner, 0n, 0n, 0n, 2n * unit]
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />))
	await waitFor(() => expect(view.container.textContent).toContain('Bid collateral is refundable. The branch activates with its collateral shortfall.'))
	expect(button(view.container, 'Withdraw this bid’s refund').disabled).toBe(false)
	expect(view.container.textContent).toContain('No winning lots')
})

test('a fully filled bid in a finalized auction offers no refund, because the engine never settles it', async () => {
	const fixture = await auctionFixture()
	fixture.values['finalized'] = true
	fixture.values['previewBid'] = [owner, 2n, 2n * unit, 200n * unit, 0n]
	const view = await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(button(view.container, 'Claim bid').disabled).toBe(false))
	expect([...view.container.querySelectorAll('button')].some(candidate => candidate.textContent === 'Withdraw this bid’s refund')).toBe(false)
})

test('#1371 a full book displays no admissible limit rather than a price below the backing floor', async () => {
	const fixture = await auctionFixture()
	fixture.values['maximumAdmissibleBidAttoRepPerLot'] = 3n * unit
	const view = await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain('Bid 1'))
	expect(view.container.textContent).toContain('No admissible new limit')
})

test('auction funding controls and bid rows stay in place through reload and failure', async () => {
	const fixture = await auctionFixture()
	const view = await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain('Bid 1'))
	expect(view.container.querySelectorAll('.card .card')).toHaveLength(0)
	const original = Array.from(view.container.querySelectorAll('button'))
	for (const name of ['Open repair auction', 'Submit funded bid', 'Withdraw this bid’s refund', 'Claim all bids', 'Refresh auction']) expect(original.some(node => node.textContent === name)).toBe(true)
	await act(() => {
		for (const [name, value] of [
			['Number of lots', '2'],
			['REP you want per lot, at least', '5'],
		] as const) {
			const input = field(view.container, name)
			input.value = value
			input.dispatchEvent(new Event('input', { bubbles: true }))
		}
	})
	await waitFor(() => expect(button(view.container, 'Submit funded bid').disabled).toBe(false))
	// Bids choose no health target; winning lots take the owner account's target later.
	expect(Array.from(view.container.querySelectorAll('.field label')).map(label => label.textContent)).not.toContain('Target health (%)')
	expect(view.container.textContent).not.toContain('vault')
	expect(metric(view.container, 'Bids to claim')).toBe('1')
	expect(view.container.textContent).not.toContain('Your bids in this auction')
	expect(view.container.textContent).not.toContain('Approve REP')
	expect(view.container.textContent).not.toContain('REP top-up')
	expect(view.container.textContent).not.toContain('Execution reserve')
	expect(metric(view.container, 'You lock until the auction closes')).toContain('2.00')
	expect(view.container.textContent).not.toContain('Credited collateral refund')
	const pending = createDeferred<bigint>()
	fixture.values['repGrid'] = pending.promise
	await act(() => button(view.container, 'Refresh auction').click())
	await waitFor(() => expect(button(view.container, 'Refresh auction').disabled).toBe(true))
	for (const node of original) expect(node.isConnected && button(view.container, node.textContent ?? '') === node).toBe(true)
	fixture.values['repGrid'] = 2n
	await act(() => pending.resolve(2n))
	await waitFor(() => expect(button(view.container, 'Refresh auction').disabled).toBe(false))
	fixture.values['controller'] = owner
	await act(() => button(view.container, 'Refresh auction').click())
	await waitFor(() => expect(view.container.textContent).toContain('The auction status or contract address does not match this branch.'))
	expect(button(view.container, 'Submit funded bid').disabled).toBe(true)
	expect(view.container.textContent).toContain('Bid 1')
})

test('funded winners show live fees until their bid is claimed, then the claim shows as done', async () => {
	const fixture = await auctionFixture()
	fixture.values['finalized'] = true
	const view = await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(metric(view.container, 'REP pledged by this bid')).toContain('100.00'))
	expect(view.container.querySelector('.statoblast-auction-bid-table')?.textContent).toContain('Winning lots')
	expect(metric(view.container, 'Clearing REP per winning lot')).toContain('100.00')
	expect(metric(view.container, 'REP pledged at closing')).toContain('100.00')
	expect(metric(view.container, 'Unclaimed collateral fees')).toContain('7.00')
	expect(metric(view.container, 'Unclaimed REP fees')).toContain('9.00')
	expect(view.container.textContent).toContain('including bids that won nothing')
	const claim = button(view.container, 'Claim bid')
	expect(claim.disabled).toBe(false)
	expect(button(view.container, 'Claim all bids').disabled).toBe(false)
	fixture.values['bids'] = [owner, false, true, 2n, 60n * unit]
	fixture.values['repairAuctionPositions'] = [[owner, 100n * unit, unit, 0n, true, 0n, 0n]]
	fixture.values['unclaimedRepairAuctionBids'] = 0n
	await act(() => button(view.container, 'Refresh auction').click())
	await waitFor(() => expect(view.container.textContent).toContain('This bid is claimed.'))
	expect(claim.disabled).toBe(true)
	expect(button(view.container, 'Claim bid')).toBe(claim)
	expect(button(view.container, 'Claim all bids').disabled).toBe(true)
	expect(metric(view.container, 'Bids to claim')).toBe('0')
	expect(view.container.textContent).not.toContain('including bids that won nothing')
})

test('every closed bid, winning or not, gets its own claim and one claim-all action covers them', async () => {
	const claimButtons = (container: HTMLElement) => [...container.querySelectorAll('button')].filter(node => node.textContent === 'Claim bid')
	const open = await auctionFixture()
	const bidding = await renderIntoDocument(<SecurityPoolRepairAuction fork={open.fork} bidder={owner} actions={actions} />)
	await waitFor(() => expect(bidding.container.textContent).toContain('Bid 1'))
	expect(claimButtons(bidding.container)).toHaveLength(0)
	expect(button(bidding.container, 'Claim all bids').disabled).toBe(true)
	expect(bidding.container.textContent).toContain('Bids can be claimed after the auction closes.')
	await bidding.cleanup()
	const lost = await auctionFixture()
	lost.values['finalized'] = true
	lost.values['previewBid'] = [owner, 0n, 0n, 0n, 2n * unit]
	lost.values['repairAuctionPositions'] = [[owner, 0n, 0n, 0n, false, 0n, 0n]]
	const losing = await renderIntoDocument(<SecurityPoolRepairAuction fork={lost.fork} bidder={owner} actions={actions} />)
	// The open auction's saved page shows first; wait for the finalized read.
	await waitFor(() => expect(claimButtons(losing.container).map(node => node.disabled)).toEqual([false]))
	await losing.cleanup()
	const won = await auctionFixture()
	won.values['finalized'] = true
	won.values['bidderBidCount'] = 2n
	won.values['unclaimedRepairAuctionBids'] = 2n
	won.values['repairAuctionPositions'] = [
		[owner, 100n * unit, unit, 0n, false, 7n * unit, 9n * unit],
		[owner, 100n * unit, unit, 0n, false, 7n * unit, 9n * unit],
	]
	const winning = await renderIntoDocument(<SecurityPoolRepairAuction fork={won.fork} bidder={owner} actions={actions} />)
	lifecycle.trackRendered(winning)
	await waitFor(() => expect(winning.container.querySelectorAll('.statoblast-auction-bid-table tbody')).toHaveLength(2))
	expect(claimButtons(winning.container)).toHaveLength(2)
	expect([...winning.container.querySelectorAll('button')].filter(node => node.textContent === 'Claim all bids')).toHaveLength(1)
	expect(metric(winning.container, 'Bids to claim')).toBe('2')
})

test('a bidder with many bids can still submit another bid', async () => {
	const fixture = await auctionFixture()
	fixture.values['bidderBidCount'] = 8n
	const view = await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain('Bid 1'))
	await act(() => {
		for (const [name, value] of [
			['Number of lots', '2'],
			['REP you want per lot, at least', '5'],
		] as const) {
			const input = field(view.container, name)
			input.value = value
			input.dispatchEvent(new Event('input', { bubbles: true }))
		}
	})
	await waitFor(() => expect(button(view.container, 'Submit funded bid').disabled).toBe(false))
	expect(view.container.textContent).not.toContain('at most 8 bids')
})

test('an early refund becomes available once better bids exclude the bid and closes after it is paid', async () => {
	const fixture = await auctionFixture()
	const view = await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain('Bid 1'))
	const refund = button(view.container, 'Withdraw this bid’s refund')
	expect(refund.disabled).toBe(true)
	expect(view.container.textContent).toContain('This bid may still win')
	fixture.values['earlyRefundAttoEth'] = 2n * unit
	await act(() => button(view.container, 'Refresh auction').click())
	await waitFor(() => expect(refund.disabled).toBe(false))
	expect(view.container.textContent).toContain('Better asks or earlier bids at the same ask take the available lots')
	expect(view.container.querySelector('[data-label="WETH refundable"]')?.textContent).toContain('2.00')
	fixture.values['earlyRefundAttoEth'] = 0n
	fixture.values['bids'] = [owner, true, false, 2n, 60n * unit]
	await act(() => button(view.container, 'Refresh auction').click())
	await waitFor(() => expect(view.container.textContent).toContain('This bid’s unused collateral was refunded.'))
	expect(view.container.querySelector('[data-label="WETH refundable"]')?.textContent).toContain('0')
	expect(view.container.querySelector('[data-label="WETH refundable"]')?.textContent).not.toContain('2.00')
	expect([...view.container.querySelectorAll('button')].some(candidate => candidate.textContent === 'Withdraw this bid’s refund')).toBe(false)
	expect(view.container.textContent).not.toContain('Credited collateral refund')
})

test.each([
	{ maximumAcceptableBid: (49n * unit) / 10n, reason: 'Better funded bids exclude this limit' },
	{ maximumAcceptableBid: 0n, reason: 'Better funded bids leave no admissible new limit' },
])('#1371 excluded bids show $reason without an allowance-read failure', async ({ maximumAcceptableBid, reason }) => {
	const fixture = await auctionFixture()
	// The default 120% health target requires 4.8 REP per lot.
	fixture.values['maximumAdmissibleBidAttoRepPerLot'] = maximumAcceptableBid
	const view = await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain('Bid 1'))
	await act(() => {
		for (const [name, value] of [
			['Number of lots', '2'],
			['REP you want per lot, at least', '5'],
		] as const) {
			const input = field(view.container, name)
			input.value = value
			input.dispatchEvent(new Event('input', { bubbles: true }))
		}
	})
	await waitFor(() => expect(view.container.textContent).toContain(reason))
	expect(button(view.container, 'Approve WETH').disabled).toBe(true)
	expect(button(view.container, 'Submit funded bid').disabled).toBe(true)
	expect(view.container.textContent).not.toContain('Unable to verify WETH approval')
	expect(view.container.textContent).not.toContain('Retry loading the approval status')
})
