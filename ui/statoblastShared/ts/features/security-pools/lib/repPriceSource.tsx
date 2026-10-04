import * as pricingCopy from '../../../copy/pricing.js'
import { getRepPriceSourceCopy, renderRepPriceSourceLabel, type RepPriceSource } from '@zoltar/ui-core-shared/lib/repPriceSource.js'
import { formatWrappedValue } from '@zoltar/ui-core-shared/copy/pricing.js'
import * as statoblastAppCopy from '../../../copy/app.js'

export type UiRepPriceSource = RepPriceSource | 'open-oracle'

/** Extends the shared REP price source copy with the Statoblast open-oracle source. */
export function getUiRepPriceSourceCopy(source: UiRepPriceSource | undefined) {
	if (source !== 'open-oracle') return getRepPriceSourceCopy(source)
	return {
		badgeLabel: statoblastAppCopy.openOracle,
		linkTitle: pricingCopy.priceFromOpenOracle,
		quotedCollateralizationLabel: pricingCopy.targetCollateralizationAtOpenOraclePrice,
		quotedRepPerEthLabel: pricingCopy.openOracleRepEth,
		tooltip: pricingCopy.openOraclePriceSourceDetail,
	}
}

export function renderUiRepPriceSourceLabel(source: UiRepPriceSource | undefined, sourceUrl: string | undefined) {
	if (source === 'open-oracle') return formatWrappedValue(statoblastAppCopy.openOracle)
	return renderRepPriceSourceLabel(source, sourceUrl)
}
