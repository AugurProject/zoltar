/// <reference types='bun-types' />

import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { TruthAuctionMarketViewSection } from '@zoltar/ui-statoblast-shared/features/truth-auctions/components/TruthAuctionMarketViewSection.js'
import { formatTruthAuctionTickPriceInput } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/truthAuctionBook.js'
import { describe, expect, mock, test } from 'bun:test'

describe('TruthAuctionMarketViewSection', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
	})

	test('keeps ladder rows free of nested buttons and disables pagination while loading', async () => {
		const rendered = await renderIntoDocument(
			<TruthAuctionMarketViewSection
				clearingTick={1n}
				hasMoreTickSummaries={true}
				hasMoreViewerBids={false}
				loadingTruthAuctionBook={true}
				maxTickAttoEth={5n}
				onLoadNextTickPage={() => undefined}
				onSelectTick={() => undefined}
				renderPriceValue={value => value?.toString()}
				showDepthClearingTick={false}
				truthAuctionBookError={undefined}
				truthAuctionDepthPoints={[
					{
						cumulativeBidAttoEth: 5n,
						currentTotalBidAttoEth: 5n,
						disposition: { label: 'Winning', tone: 'success' },
						isPreviewTick: false,
						isSelected: true,
						price: 2n,
						submissionCount: 1n,
						tick: 1n,
						viewerBidAttoEth: 0n,
					},
				]}
			/>,
		)
		cleanupRendered = rendered.cleanup

		const ladderRow = document.querySelector('.truth-auction-ladder-row')
		if (!(ladderRow instanceof HTMLButtonElement)) throw new Error('Expected a selectable ladder row')
		expect(ladderRow.querySelector('button')).toBeNull()
		expect(ladderRow.classList.contains('is-clearing')).toBe(false)
		expect(ladderRow.textContent).not.toContain('Clearing level')
		const loadMoreButton = within(document.body).getByRole('button', { name: 'Show more price levels' }) as HTMLButtonElement
		expect(loadMoreButton.disabled).toBe(true)
		expect(document.querySelectorAll('[data-message-placement] .loading-value[role="status"]')).toHaveLength(1)
	})

	test('marks the ladder prices that hold the connected wallet bids with their total', async () => {
		const point = { cumulativeBidAttoEth: 5n * 10n ** 18n, currentTotalBidAttoEth: 5n * 10n ** 18n, disposition: { label: 'Winning', tone: 'success' as const }, isPreviewTick: false, isSelected: false, price: 2n, submissionCount: 2n }
		const renderLadder = (hasMoreViewerBids: boolean) =>
			renderIntoDocument(
				<TruthAuctionMarketViewSection
					clearingTick={1n}
					hasMoreTickSummaries={false}
					hasMoreViewerBids={hasMoreViewerBids}
					loadingTruthAuctionBook={false}
					maxTickAttoEth={5n * 10n ** 18n}
					onLoadNextTickPage={() => undefined}
					onSelectTick={() => undefined}
					renderPriceValue={value => value?.toString()}
					showDepthClearingTick={false}
					truthAuctionBookError={undefined}
					truthAuctionDepthPoints={[
						{ ...point, tick: 2n, viewerBidAttoEth: 3n * 10n ** 18n },
						{ ...point, tick: 1n, viewerBidAttoEth: 0n },
						{ ...point, tick: 0n, viewerBidAttoEth: 2n * 10n ** 18n },
					]}
				/>,
			)
		const rendered = await renderLadder(false)
		cleanupRendered = rendered.cleanup
		const rows = Array.from(document.querySelectorAll('.truth-auction-ladder-row'))
		expect(rows.map(row => row.classList.contains('has-viewer-bid'))).toEqual([true, false, true])
		expect(rows[0]?.querySelector('.truth-auction-ladder-yours')?.textContent).toBe('Yours 3.00 ETH')
		expect(rows[1]?.querySelector('.truth-auction-ladder-yours')).toBeNull()
		expect(rows[2]?.querySelector('.truth-auction-ladder-yours')?.textContent).toBe('Yours 2.00 ETH')
		await rendered.cleanup()

		// While more of the wallet's bids are still to load, each total reads as a lower bound.
		const partial = await renderLadder(true)
		cleanupRendered = partial.cleanup
		expect(Array.from(document.querySelectorAll('.truth-auction-ladder-yours')).map(element => element.textContent)).toEqual(['Yours ≥ 3.00 ETH', 'Yours ≥ 2.00 ETH'])
	})

	test('depth-chart points announce the price they fill, the depth, and the clearing and bid-price status', async () => {
		const onSelectTick = mock((_tick: bigint) => undefined)
		const point = { cumulativeBidAttoEth: 3n * 10n ** 18n, currentTotalBidAttoEth: 10n ** 18n, disposition: { label: 'Winning', tone: 'success' as const }, isPreviewTick: true, isSelected: false, price: 2n, submissionCount: 1n, viewerBidAttoEth: 0n }
		const rendered = await renderIntoDocument(
			<TruthAuctionMarketViewSection
				clearingTick={1n}
				hasMoreTickSummaries={false}
				hasMoreViewerBids={false}
				loadingTruthAuctionBook={false}
				maxTickAttoEth={10n ** 18n}
				onLoadNextTickPage={() => undefined}
				onSelectTick={onSelectTick}
				renderPriceValue={value => value?.toString()}
				showDepthClearingTick={true}
				truthAuctionBookError={undefined}
				truthAuctionDepthPoints={[
					{ ...point, tick: 1n },
					{ ...point, isPreviewTick: false, tick: 0n },
				]}
			/>,
		)
		cleanupRendered = rendered.cleanup
		// The label uses the same formatter as the bid-price fill, so the announced price is the price that gets filled.
		const clearingLabel = `Select bid price ${formatTruthAuctionTickPriceInput(1n)}\u00a0ETH per REP. 3\u00a0ETH bid at or above this price. Current clearing price and your bid price.`
		const clearingPoint = within(document.body).getByRole('button', { name: clearingLabel })
		fireEvent.click(clearingPoint)
		expect(onSelectTick).toHaveBeenCalledWith(1n)
		expect(within(document.body).getByRole('button', { name: `Select bid price ${formatTruthAuctionTickPriceInput(0n)}\u00a0ETH per REP. 3\u00a0ETH bid at or above this price.` })).not.toBeNull()
	})
})
