import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { getInitialPriceWarning } from '../lib/initialPriceReference.js'

/** Warns without blocking when a proposed price is far from the reference or looks inverted. The polite region stays mounted so a warning that appears while typing is announced. */
export function InitialPriceWarning({ id, price, referencePrice }: { id?: string | undefined; price: bigint | undefined; referencePrice: bigint | undefined }) {
	const warning = getInitialPriceWarning(price, referencePrice)
	return (
		<div aria-live='polite' className='field-error-live-region'>
			{warning === undefined ? undefined : <UserMessage placement='field' tone='warning' id={id} detail={warning} />}
		</div>
	)
}
