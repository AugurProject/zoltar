type CentralizedMarket = {
	askDepthEth: string
	bidDepthEth: string
	observations: readonly unknown[]
	priceRepPerEth: string
	reasons: readonly string[]
	reliable: boolean
}

type MarketConsensus = {
	cex: { askDepthEth: string; bidDepthEth: string; priceRepPerEth: string; reliable: boolean; sourceCount: number }
	dex: { askDepthEth: string; bidDepthEth: string; priceRepPerEth: string; reliable: boolean; sourceCount: number }
	priceRepPerEth?: string | undefined
	reasons: readonly string[]
	reliable: boolean
}

export function marketPresentation(market: CentralizedMarket | undefined, consensus: MarketConsensus | undefined) {
	return {
		dexPrice: consensus?.dex.reliable === true ? consensus.dex.priceRepPerEth : '—',
		guardedPrice: consensus?.reliable === true ? (consensus.priceRepPerEth ?? '—') : '—',
		dexBidDepth: consensus === undefined ? '—' : `${consensus.dex.bidDepthEth} ETH`,
		dexAskDepth: consensus === undefined ? '—' : `${consensus.dex.askDepthEth} ETH`,
		status:
			market === undefined
				? consensus === undefined
					? 'No market sources configured'
					: consensus.reliable
						? 'Reliable DEX consensus'
						: consensus.reasons.join(' · ')
				: consensus === undefined
					? market.reliable
						? 'Reliable CEX estimate'
						: market.reasons.join(' · ')
					: consensus.reliable
						? 'Reliable independent CEX + DEX consensus'
						: consensus.reasons.join(' · '),
		price: market?.priceRepPerEth ?? '—',
		bidDepth: market === undefined ? '—' : `${market.bidDepthEth} ETH`,
		askDepth: market === undefined ? '—' : `${market.askDepthEth} ETH`,
		sourceCount: consensus === undefined ? `${(market?.observations.length ?? 0).toString()} CEX` : `${consensus.cex.sourceCount.toString()} CEX · ${consensus.dex.sourceCount.toString()} DEX`,
	}
}
