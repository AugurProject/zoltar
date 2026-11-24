import { renderRepPriceSourceLabel, type RepPriceSource } from '@zoltar/ui-core-shared/lib/repPriceSource.js'
import { formatWrappedValue } from '@zoltar/ui-core-shared/copy/pricing.js'
import * as statoblastAppCopy from '../../../copy/app.js'

export type UiRepPriceSource = RepPriceSource | 'open-oracle'

export function renderUiRepPriceSourceLabel(source: UiRepPriceSource | undefined, sourceUrl: string | undefined) {
	if (source === 'open-oracle') return formatWrappedValue(statoblastAppCopy.openOracle)
	return renderRepPriceSourceLabel(source, sourceUrl)
}
