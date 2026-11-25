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
import { auctionFixture, auctionVault } from './auctionFixture.js'
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
	expect(scale?.textContent).toContain('Your lowest')
	expect(scale?.textContent).toContain('4.80')
	expect(scale?.textContent).toContain('Highest now')
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
	fixture.values['clearing'] = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, false]
	fixture.values['previewBid'] = [owner, auctionVault, 12_000n, 0n, 0n, 0n, 2n * unit]
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />))
	await waitFor(() => expect(view.container.textContent).toContain('Bid collateral is refundable. The branch activates with its collateral shortfall.'))
	expect(button(view.container, 'Credit and withdraw refunds').disabled).toBe(false)
	expect(view.container.textContent).toContain('No winning lots')
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
	for (const name of ['Open recapitalization auction', 'Submit funded bid', 'Credit this bid’s refunds', 'Credit and withdraw refunds', 'Activate position controls', 'Manage position', 'Withdraw credited refunds', 'Refresh auction']) expect(original.some(node => node.textContent === name)).toBe(true)
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
	expect(view.container.textContent).not.toContain('Approve REP')
	expect(view.container.textContent).not.toContain('REP top-up')
	expect(view.container.textContent).not.toContain('Execution reserve')
	expect(metric(view.container, 'You lock until the auction closes')).toContain('2.00')
	expect(view.container.textContent).not.toContain('Credited REP refund')
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
	await waitFor(() => expect(view.container.textContent).toContain('identity or state'))
	expect(button(view.container, 'Submit funded bid').disabled).toBe(true)
	expect(view.container.textContent).toContain('Bid 1')
})

test('funded unclaimed winners show live fees and separate activation from management', async () => {
	const fixture = await auctionFixture()
	fixture.values['finalized'] = true
	const opened: string[] = []
	const view = await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} openVault={vault => opened.push(vault)} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain('Funded position'))
	expect(metric(view.container, 'Current pledged REP')).toContain('100.00')
	expect(metric(view.container, 'Clearing REP per winning lot')).toContain('100.00')
	expect(metric(view.container, 'REP pledged at closing')).toContain('100.00')
	expect(metric(view.container, 'Unclaimed collateral fees')).toContain('7.00')
	expect(metric(view.container, 'Unclaimed REP fees')).toContain('9.00')
	expect(button(view.container, 'Activate position controls').disabled).toBe(false)
	expect(button(view.container, 'Manage position').disabled).toBe(true)
	fixture.values['bids'] = [owner, auctionVault, 12_000n, 2n, 60n * unit, false, true]
	fixture.values['repairAuctionPosition'] = [auctionVault, 8n, 100n * unit, unit, 12_000n, 0n, true, 7n * unit, 9n * unit]
	await act(() => button(view.container, 'Refresh auction').click())
	await waitFor(() => expect(button(view.container, 'Manage position').disabled).toBe(false))
	expect(button(view.container, 'Activate position controls').disabled).toBe(true)
	await act(() => button(view.container, 'Manage position').click())
	expect(opened).toEqual([auctionVault])
})

test('early refund status enables only crediting then a separate unrestricted withdrawal', async () => {
	const fixture = await auctionFixture()
	const view = await renderIntoDocument(<SecurityPoolRepairAuction fork={fixture.fork} bidder={owner} actions={actions} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain('Bid 1'))
	const credit = button(view.container, 'Credit this bid’s refunds')
	const claim = button(view.container, 'Credit and withdraw refunds')
	const withdraw = button(view.container, 'Withdraw credited refunds')
	expect(credit.disabled).toBe(true)
	expect(claim.disabled).toBe(true)
	// Both refund buttons rest on the same cause, stated once for the pair and referenced by each button.
	expect(view.container.textContent?.split('This bid may still win')).toHaveLength(2)
	expect(credit.getAttribute('aria-describedby')).toBeTruthy()
	expect(credit.getAttribute('aria-describedby')).toBe(claim.getAttribute('aria-describedby'))
	fixture.values['earlyRefundAttoEth'] = 2n * unit
	await act(() => button(view.container, 'Refresh auction').click())
	await waitFor(() => expect(credit.disabled).toBe(false))
	expect(claim.disabled).toBe(false)
	expect(view.container.textContent).toContain('Better asks or earlier bids at the same ask take the available lots')
	expect(view.container.querySelector('[data-label="WETH refundable"]')?.textContent).toContain('2.00')
	expect(withdraw.disabled).toBe(true)
	fixture.values['earlyRefundAttoEth'] = 0n
	fixture.values['bids'] = [owner, auctionVault, 12_000n, 2n, 60n * unit, true, false]
	fixture.values['refundCreditAttoEth'] = 2n * unit
	await act(() => button(view.container, 'Refresh auction').click())
	await waitFor(() => expect(withdraw.disabled).toBe(false))
	expect(credit.disabled).toBe(true)
	// The credited bid can still use the combined path, which only withdraws.
	expect(claim.disabled).toBe(false)
	expect(view.container.textContent).toContain('Its collateral refund has been credited for withdrawal')
	expect(view.container.textContent).not.toContain('credited and withdrawn')
	expect(button(view.container, 'Credit this bid’s refunds')).toBe(credit)
	expect(button(view.container, 'Credit and withdraw refunds')).toBe(claim)
	expect(button(view.container, 'Withdraw credited refunds')).toBe(withdraw)
	fixture.values['refundCreditAttoEth'] = 0n
	await act(() => button(view.container, 'Refresh auction').click())
	await waitFor(() => expect(view.container.textContent).toContain('credited and withdrawn'))
	expect(withdraw.disabled).toBe(true)
	expect(claim.disabled).toBe(true)
	expect(view.container.textContent).toContain('No refund credit remains to withdraw.')
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
