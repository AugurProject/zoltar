/// <reference types='bun-types' />

import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { TruthAuctionMarketViewSection } from '@zoltar/ui-statoblast-shared/features/truth-auctions/components/TruthAuctionMarketViewSection.js'
import { describe, expect, test } from 'bun:test'

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
				clearingTick={undefined}
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
		const loadMoreButton = within(document.body).getByRole('button', { name: 'Show more price levels' }) as HTMLButtonElement
		expect(loadMoreButton.disabled).toBe(true)
	})
})
