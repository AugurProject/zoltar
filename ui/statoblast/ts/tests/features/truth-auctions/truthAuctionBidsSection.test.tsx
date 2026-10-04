/// <reference types='bun-types' />

import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { TruthAuctionBidsSection, ViewerTruthAuctionBidsSection } from '@zoltar/ui-statoblast-shared/features/truth-auctions/components/TruthAuctionBidsSection.js'
import { ForkAuctionStartSection } from '@zoltar/ui-statoblast-shared/features/truth-auctions/components/ForkAuctionActionSections.js'
import { describe, expect, test } from 'bun:test'
import type { ComponentChildren } from 'preact'

const walletAddress: Address = '0x0000000000000000000000000000000000000001'

function renderPriceValue(value: bigint | undefined): ComponentChildren {
	if (value === undefined) return 'No price'
	return `Price ${value.toString()}`
}

describe('TruthAuctionBidsSection', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
	})

	test('shows auction bid loading and empty states', async () => {
		const rendered = await renderIntoDocument(<TruthAuctionBidsSection aggregatedAuctionBidCountForLoadedTicks={0n} hasMoreAggregatedAuctionBids={false} loadedTickCount={0} loadingAggregatedAuctionBids={true} onLoadNextAuctionBidPage={() => undefined} renderPriceValue={renderPriceValue} rows={[]} />)
		cleanupRendered = rendered.cleanup

		expect(within(document.body).getByRole('heading', { name: 'Current bids' })).not.toBeNull()
		expect(within(document.body).getByText(/Loading truth auction bids/)).not.toBeNull()

		await rendered.unmount()
		cleanupRendered = undefined
		const emptyRendered = await renderIntoDocument(<TruthAuctionBidsSection aggregatedAuctionBidCountForLoadedTicks={0n} hasMoreAggregatedAuctionBids={false} loadedTickCount={0} loadingAggregatedAuctionBids={false} onLoadNextAuctionBidPage={() => undefined} renderPriceValue={renderPriceValue} rows={[]} />)
		cleanupRendered = emptyRendered.cleanup

		expect(within(document.body).getByText('This truth auction has no active bids.')).not.toBeNull()
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
						bidAmountAttoEth: 2n,
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
		expect(priceValue.getAttribute('data-label')).toBe('Price (ETH per REP)')
		expect(statusValue.parentElement?.getAttribute('data-label')).toBe('Status')
		const bidHistory = within(document.body).getByRole('table', { name: 'Current bids' })
		const scrollRegion = within(document.body).getByRole('region', { name: 'Scrollable list of current bids' })
		expect(scrollRegion.className).toContain('truth-auction-bid-table-scroll')
		expect(scrollRegion.getAttribute('tabindex')).toBe('0')
		expect(scrollRegion.contains(bidHistory)).toBe(true)
		expect(within(bidHistory).getAllByRole('columnheader')).toHaveLength(4)
		expect(within(bidHistory).getAllByRole('row')).toHaveLength(2)
		expect(within(bidHistory).getAllByRole('cell')).toHaveLength(4)
		expect(within(document.body).getByText('Showing 1 of 3 bids at the loaded prices.')).not.toBeNull()
		expect(within(bidHistory).queryByRole('button', { name: /Copy address/ })).toBeNull()
		expect(within(bidHistory).queryByRole('button', { name: /Copy exact value/ })).toBeNull()
		fireEvent.click(within(document.body).getByRole('button', { name: 'Show more truth auction bids' }))
		expect(loadMoreCalls).toBe(1)
	})

	test('disables auction bid pagination while the next page is loading', async () => {
		const rendered = await renderIntoDocument(<TruthAuctionBidsSection aggregatedAuctionBidCountForLoadedTicks={0n} hasMoreAggregatedAuctionBids={true} loadedTickCount={1} loadingAggregatedAuctionBids={true} onLoadNextAuctionBidPage={() => undefined} renderPriceValue={renderPriceValue} rows={[]} />)
		cleanupRendered = rendered.cleanup

		const loadMoreButton = within(document.body).getByRole('button', { name: 'Show more truth auction bids' }) as HTMLButtonElement
		expect(loadMoreButton.disabled).toBe(true)
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
		expect(documentQueries.queryByText('This truth auction has no active bids.')).toBeNull()
		expect(documentQueries.queryByText('Visible levels')).toBeNull()
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
		expect(retryingButton.textContent).toContain('Retrying truth auction bids…')
	})
})

describe('ViewerTruthAuctionBidsSection', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
	})

	test('prompts for a wallet before showing viewer bids', async () => {
		const rendered = await renderIntoDocument(
			<ViewerTruthAuctionBidsSection
				accountAddress={undefined}
				hasMoreViewerBids={false}
				loadingTruthAuctionBook={false}
				onLoadNextViewerBidPage={() => undefined}
				onSettlementBidSelectionChange={() => undefined}
				onSettlementBidSelectionReplace={() => undefined}
				renderPriceValue={renderPriceValue}
				rows={[]}
				showSettlementActionColumn={false}
			/>,
		)
		cleanupRendered = rendered.cleanup

		expect(within(document.body).getByText('Connect a wallet to inspect your submitted truth auction bids.')).not.toBeNull()
		expect(document.body.querySelector('input[type="checkbox"]')).toBeNull()
	})

	test('renders settlement controls and emits selection changes', async () => {
		const selectionChanges: Array<{ bidKey: string; checked: boolean }> = []
		const selectionReplacements: string[][] = []
		const rendered = await renderIntoDocument(
			<ViewerTruthAuctionBidsSection
				accountAddress={walletAddress}
				hasMoreViewerBids={true}
				loadingTruthAuctionBook={false}
				onLoadNextViewerBidPage={() => undefined}
				onSettlementBidSelectionChange={(bidKey, checked) => {
					selectionChanges.push({ bidKey, checked })
				}}
				onSettlementBidSelectionReplace={bidKeys => {
					selectionReplacements.push(bidKeys)
				}}
				renderPriceValue={renderPriceValue}
				rows={[
					{
						bidAmountAttoEth: 2n,
						estimate: { refundAttoEth: 5n * 10n ** 17n, repAttoRep: 3n * 10n ** 18n },
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
		expect(within(document.body).getByText('3.00 REP')).not.toBeNull()
		expect(within(document.body).getByText('0.50 ETH refund')).not.toBeNull()
		expect((within(document.body).getByRole('button', { name: 'Clear selection' }) as HTMLButtonElement).disabled).toBe(true)
		fireEvent.click(within(document.body).getByRole('button', { name: 'Select all' }))
		expect(selectionReplacements).toEqual([['11:1']])
		expect(within(document.body).getByRole('button', { name: 'Show more of my bids' })).not.toBeNull()
	})

	test('hides the estimated result column once no bid has a pending outcome', async () => {
		const rendered = await renderIntoDocument(
			<ViewerTruthAuctionBidsSection
				accountAddress={walletAddress}
				hasMoreViewerBids={false}
				loadingTruthAuctionBook={false}
				onLoadNextViewerBidPage={() => undefined}
				onSettlementBidSelectionChange={() => undefined}
				onSettlementBidSelectionReplace={() => undefined}
				renderPriceValue={renderPriceValue}
				rows={[{ bidAmountAttoEth: 2n, estimate: undefined, key: 'viewer:11:1', price: 42n, settlementControl: undefined, statusLabel: 'Claimed', statusToneClassName: 'is-success' }]}
				showSettlementActionColumn={false}
			/>,
		)
		cleanupRendered = rendered.cleanup

		const myBids = within(document.body).getByRole('table', { name: 'My bids' })
		expect(within(myBids).queryByText('Estimated result')).toBeNull()
		expect(within(myBids).getAllByRole('columnheader')).toHaveLength(3)
		expect(within(myBids).getAllByRole('cell')).toHaveLength(3)
	})

	test('disables viewer bid pagination while the next page is loading', async () => {
		const rendered = await renderIntoDocument(
			<ViewerTruthAuctionBidsSection
				accountAddress={walletAddress}
				hasMoreViewerBids={true}
				loadingTruthAuctionBook={true}
				onLoadNextViewerBidPage={() => undefined}
				onSettlementBidSelectionChange={() => undefined}
				onSettlementBidSelectionReplace={() => undefined}
				renderPriceValue={renderPriceValue}
				rows={[]}
				showSettlementActionColumn={false}
			/>,
		)
		cleanupRendered = rendered.cleanup

		const loadMoreButton = within(document.body).getByRole('button', { name: 'Show more of my bids' }) as HTMLButtonElement
		expect(loadMoreButton.disabled).toBe(true)
	})

	test('shows bid-book recovery instead of a false empty My bids state', async () => {
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
				onSettlementBidSelectionReplace={() => undefined}
				renderPriceValue={renderPriceValue}
				rows={[]}
				showSettlementActionColumn={true}
			/>,
		)
		cleanupRendered = rendered.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Failed to load truth auction bidbook')).not.toBeNull()
		expect(documentQueries.queryByText('No bids from this wallet were found for this truth auction.')).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Show more of my bids' })).toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Retry my bids' }))
		expect(retryCalls).toBe(1)
	})

	test('the start section drops the auction explanation when the truth auction is bypassed', async () => {
		const rendered = await renderIntoDocument(<ForkAuctionStartSection actionButton={undefined} bypassReason={undefined} readyInText={undefined} />)
		cleanupRendered = rendered.cleanup
		expect(within(document.body).getByRole('heading', { name: 'Start truth auction' })).not.toBeNull()
		expect(document.body.textContent).toContain('Start the ETH-for-REP truth auction')

		await rendered.unmount()
		cleanupRendered = undefined
		const bypassRendered = await renderIntoDocument(<ForkAuctionStartSection actionButton={undefined} bypassReason='No truth auction is needed.' readyInText={undefined} />)
		cleanupRendered = bypassRendered.cleanup
		expect(within(document.body).getByRole('heading', { name: 'Bypass truth auction' })).not.toBeNull()
		expect(document.body.textContent).toContain('No truth auction is needed.')
		expect(document.body.textContent).not.toContain('Start the ETH-for-REP truth auction')
	})
})
