import * as marketCopy from '@zoltar/ui-zoltar/copy/market.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import type { MarketType } from '@zoltar/ui-core-shared/types/contracts.js'

export function getMarketTypeLabel(marketType: MarketType) {
	switch (marketType) {
		case 'binary':
			return marketCopy.binary
		case 'categorical':
			return marketCopy.categorical
		case 'scalar':
			return marketCopy.scalar
		default:
			return assertNever(marketType)
	}
}
