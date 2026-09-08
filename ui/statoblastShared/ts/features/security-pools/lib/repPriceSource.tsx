import * as pricingCopy from '../../../copy/pricing.js'
import { getRepPriceSourceCopy as getSharedRepPriceSourceCopy, renderRepPriceSourceLabel as renderSharedRepPriceSourceLabel, type RepPriceSource } from '@zoltar/ui-core-shared/lib/repPriceSource.js'
import { formatWrappedValue } from '@zoltar/ui-core-shared/copy/pricing.js'

export type UiRepPriceSource = RepPriceSource | 'open-oracle'

export function getRepPriceSourceCopy(source: UiRepPriceSource | undefined) {
	if (source !== 'open-oracle') return getSharedRepPriceSourceCopy(source)
	return {
		badgeLabel: pricingCopy.openOracleBadgeLabel,
		linkTitle: pricingCopy.priceFromOpenOracle,
		quotedCollateralizationLabel: pricingCopy.targetCollateralizationAtOpenOraclePrice,
		quotedRepPerEthLabel: pricingCopy.openOracleRepEth,
		tooltip: pricingCopy.openOraclePriceSourceDetail,
	}
}

export function renderRepPriceSourceLabel(source: UiRepPriceSource | undefined, sourceUrl: string | undefined) {
	if (source === 'open-oracle') return formatWrappedValue(pricingCopy.openOracleBadgeLabel)
	return renderSharedRepPriceSourceLabel(source, sourceUrl)
}
