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

	test('depth-chart points announce the price they fill, the depth, and the clearing and bid-price status', async () => {
		const onSelectTick = mock((_tick: bigint) => undefined)
		const point = { cumulativeBidAttoEth: 3n * 10n ** 18n, currentTotalBidAttoEth: 10n ** 18n, disposition: { label: 'Winning', tone: 'success' as const }, isPreviewTick: true, isSelected: false, price: 2n, submissionCount: 1n }
		const rendered = await renderIntoDocument(
			<TruthAuctionMarketViewSection
				clearingTick={1n}
				hasMoreTickSummaries={false}
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
