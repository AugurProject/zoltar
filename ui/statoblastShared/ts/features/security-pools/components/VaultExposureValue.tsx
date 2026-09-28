import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

/** A vault's standing ETH commitment; it does not depend on the REP price. */
export function VaultExposureValue({ capacity }: { capacity: bigint | undefined }) {
	if (capacity === undefined) return <>{commonCopy.metricUnavailablePlaceholder}</>
	return <CurrencyValue exactWhenRoundedToZero value={capacity} suffix={commonCopy.eth} />
}
