import { protocolGuideHref } from '@zoltar/ui-core-shared/copy/app.js'

/** An absolute link to a page of the protocol documentation, which opens outside the app. */
function tradingDocsHref(documentPath: string) {
	return new URL(documentPath, protocolGuideHref).href
}

/** Where a trader learns how to get a security pool address to open a market. */
export const findMarketGuideHref = tradingDocsHref('tutorials/trading-first-trade.html#choose')
/** Where a market creator learns how to get a security pool address from Statoblast. */
export const findSecurityPoolGuideHref = tradingDocsHref('tutorials/trading-first-market.html#find-pool')
/** Trading's documentation: creating markets, liquidity, resolution, and forks. */
export const createMarketGuideHref = tradingDocsHref('tutorials/trading-first-market.html')
export const handleResolutionGuideHref = tradingDocsHref('how-to/trading-handle-resolution.html')
export const handleForkGuideHref = tradingDocsHref('how-to/trading-handle-a-fork.html')
export const deployContractsGuideHref = tradingDocsHref('how-to/trading-deploy-contracts.html')
