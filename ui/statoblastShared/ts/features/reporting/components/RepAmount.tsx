import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { AmountRounding } from '@zoltar/ui-core-shared/lib/formatters.js'

/** A REP amount inside a status sentence: rounded, with the exact value on hover and for screen readers. A minimum the user must reach rounds `up`, so the shown figure is always enough. */
export function RepAmount({ rounding = 'nearest', value }: { rounding?: AmountRounding; value: bigint }) {
	return <CurrencyValue rounding={rounding} value={value} suffix={commonCopy.rep} />
}

export function renderRepAmount(value: bigint, rounding?: AmountRounding) {
	return <RepAmount value={value} {...(rounding === undefined ? {} : { rounding })} />
}
