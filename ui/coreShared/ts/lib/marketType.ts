import { assertNever } from './assert.js'
import * as marketCopy from '../copy/marketType.js'
import type { MarketType } from '../types/contracts.js'

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
