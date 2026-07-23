/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { ComponentChildren } from 'preact'
import type { Address } from '@zoltar/shared/ethereum'
import { TruthAuctionBidsSection, ViewerTruthAuctionBidsSection } from '../../../features/truth-auctions/components/TruthAuctionBidsSection.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { fireEvent, within } from '../../testUtils/queries.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

const walletAddress: Address = '0x0000000000000000000000000000000000000001'

function renderPriceValue(value: bigint | undefined): ComponentChildren {
	if (value === undefined) return 'No price'
	return `Price ${value.toString()}`
}

describe('TruthAuctionBidsSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRendered: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRendered?.()
		cleanupRendered = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('shows auction bid loading and empty states', async () => {
		const rendered = await renderIntoDocument(<TruthAuctionBidsSection aggregatedAuctionBidCountForLoadedTicks={0n} hasMoreAggregatedAuctionBids={false} loadedTickCount={0} loadingAggregatedAuctionBids={true} onLoadNextAuctionBidPage={() => undefined} renderPriceValue={renderPriceValue} rows={[]} />)
		cleanupRendered = rendered.cleanup

		expect(within(document.body).getByRole('heading', { name: 'Current Bids' })).not.toBeNull()
		expect(within(document.body).getByText(/Loading auction bids/)).not.toBeNull()

		await rendered.unmount()
		cleanupRendered = undefined
		const emptyRendered = await renderIntoDocument(<TruthAuctionBidsSection aggregatedAuctionBidCountForLoadedTicks={0n} hasMoreAggregatedAuctionBids={false} loadedTickCount={0} loadingAggregatedAuctionBids={false} onLoadNextAuctionBidPage={() => undefined} renderPriceValue={renderPriceValue} rows={[]} />)
		cleanupRendered = emptyRendered.cleanup

		expect(within(document.body).getByText('No active prices are currently visible for this auction.')).not.toBeNull()
	})

	test('renders auction bid rows and load-more action', async () => {
		let loadMoreCalls = 0
		const rendered = await renderIntoDocument(
			<TruthAuctionBidsSection
				aggregatedAuctionBidCountForLoadedTicks={3n}
				hasMoreAggregatedAuctionBids={true}
				loadedTickCount={2}
				loadingAggregatedAuctionBids={false}
				onLoadNextAuctionBidPage={() => {
					loadMoreCalls += 1
				}}
				renderPriceValue={renderPriceValue}
				rows={[
					{
						bidder: walletAddress,
						cumulativeEth: 5n,
						ethAmount: 2n,
						key: 'aggregate:11:1',
						price: 42n,
						statusLabel: 'Winning',
						statusToneClassName: 'is-success',
					},
				]}
			/>,
		)
		cleanupRendered = rendered.cleanup

		const priceValue = within(document.body).getByText('Price 42')
		const statusValue = within(document.body).getByText('Winning')
		expect(priceValue.getAttribute('data-label')).toBe('Price (ETH / REP)')
		expect(statusValue.parentElement?.getAttribute('data-label')).toBe('Status')
		const bidHistory = within(document.body).getByRole('region', { name: 'Auction bid history' })
		expect(bidHistory.className).not.toContain('truth-auction-bid-table-scroll')
		expect(bidHistory.hasAttribute('tabindex')).toBe(false)
		fireEvent.click(within(document.body).getByRole('button', { name: 'Show More Truth Auction Bids' }))
		expect(loadMoreCalls).toBe(1)
	})

	test('shows bid-book errors with retry instead of an empty-auction message', async () => {
		let retryCalls = 0
		const rendered = await renderIntoDocument(
			<TruthAuctionBidsSection
				aggregatedAuctionBidCountForLoadedTicks={0n}
				error='Failed to load truth auction bidbook'
				hasLoadedData={false}
				hasMoreAggregatedAuctionBids={false}
				loadedTickCount={0}
				loadingAggregatedAuctionBids={false}
				onLoadNextAuctionBidPage={() => undefined}
				onRetry={() => {
					retryCalls += 1
				}}
				renderPriceValue={renderPriceValue}
				rows={[]}
			/>,
		)
		cleanupRendered = rendered.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Failed to load truth auction bidbook')).not.toBeNull()
		expect(documentQueries.queryByText('No active prices are currently visible for this auction.')).toBeNull()
		expect(documentQueries.queryByText('Visible Levels')).toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Retry current bids' }))
		expect(retryCalls).toBe(1)

		await rendered.unmount()
		cleanupRendered = undefined
		const retryingRendered = await renderIntoDocument(
			<TruthAuctionBidsSection
				aggregatedAuctionBidCountForLoadedTicks={0n}
				error='Failed to load truth auction bidbook'
				hasMoreAggregatedAuctionBids={false}
				loadedTickCount={0}
				loadingAggregatedAuctionBids={true}
				onLoadNextAuctionBidPage={() => undefined}
				onRetry={() => undefined}
				renderPriceValue={renderPriceValue}
				retrying={true}
				rows={[]}
			/>,
		)
		cleanupRendered = retryingRendered.cleanup

		const retryingButton = within(document.body).getByRole('button', { name: 'Retry current bids' })
		expect(retryingButton.hasAttribute('disabled')).toBe(true)
		expect(retryingButton.textContent).toContain('Retrying auction bids…')
	})
})

describe('ViewerTruthAuctionBidsSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRendered: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRendered?.()
		cleanupRendered = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('prompts for a wallet before showing viewer bids', async () => {
		const rendered = await renderIntoDocument(
			<ViewerTruthAuctionBidsSection accountAddress={undefined} hasMoreViewerBids={false} loadingTruthAuctionBook={false} onLoadNextViewerBidPage={() => undefined} onSettlementBidSelectionChange={() => undefined} renderPriceValue={renderPriceValue} rows={[]} showSettlementActionColumn={false} />,
		)
		cleanupRendered = rendered.cleanup

		expect(within(document.body).getByText('Connect a wallet to inspect your submitted truth auction bids.')).not.toBeNull()
		expect(document.body.querySelector('input[type="checkbox"]')).toBeNull()
	})

	test('renders settlement controls and emits selection changes', async () => {
		const selectionChanges: Array<{ bidKey: string; checked: boolean }> = []
		const rendered = await renderIntoDocument(
			<ViewerTruthAuctionBidsSection
				accountAddress={walletAddress}
				hasMoreViewerBids={true}
				loadingTruthAuctionBook={false}
				onLoadNextViewerBidPage={() => undefined}
				onSettlementBidSelectionChange={(bidKey, checked) => {
					selectionChanges.push({ bidKey, checked })
				}}
				renderPriceValue={renderPriceValue}
				rows={[
					{
						ethAmount: 2n,
						key: 'viewer:11:1',
						price: 42n,
						settlementControl: {
							ariaLabel: 'Select bid for settlement',
							bidKey: '11:1',
							checked: false,
							disabled: false,
							title: 'Select bid for settlement',
						},
						statusLabel: 'Winning',
						statusToneClassName: 'is-success',
					},
				]}
				showSettlementActionColumn={true}
			/>,
		)
		cleanupRendered = rendered.cleanup

		const checkbox = within(document.body).getByRole('checkbox', { name: 'Select bid for settlement' }) as HTMLInputElement
		expect(checkbox.disabled).toBe(false)
		fireEvent.change(checkbox, { target: { checked: true } })
		expect(selectionChanges).toEqual([{ bidKey: '11:1', checked: true }])
		expect(within(document.body).getByRole('button', { name: 'Show More Of My Bids' })).not.toBeNull()
	})

	test('shows bid-book recovery instead of a false empty My Bids state', async () => {
		let retryCalls = 0
		const rendered = await renderIntoDocument(
			<ViewerTruthAuctionBidsSection
				accountAddress={walletAddress}
				error='Failed to load truth auction bidbook'
				hasLoadedData={false}
				hasMoreViewerBids={true}
				loadingTruthAuctionBook={false}
				onLoadNextViewerBidPage={() => undefined}
				onRetry={() => {
					retryCalls += 1
				}}
				onSettlementBidSelectionChange={() => undefined}
				renderPriceValue={renderPriceValue}
				rows={[]}
				showSettlementActionColumn={true}
			/>,
		)
		cleanupRendered = rendered.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Failed to load truth auction bidbook')).not.toBeNull()
		expect(documentQueries.queryByText('No bids from this wallet are indexed for the current auction.')).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Show More Of My Bids' })).toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Retry my bids' }))
		expect(retryCalls).toBe(1)
	})
})
