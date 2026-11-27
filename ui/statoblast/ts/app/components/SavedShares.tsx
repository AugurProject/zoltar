import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import * as pageCopy from '@zoltar/ui-statoblast-shared/copy/questionPage.js'

export function decodeSharesBalance(value: unknown) {
	const balances = decodeStoredValue(value, read => ({
		decimals: read.number('decimals'),
		yesAttoShares: read.bigint('yesAttoShares'),
		noAttoShares: read.bigint('noAttoShares'),
		invalidAttoShares: read.bigint('invalidAttoShares'),
	}))
	return balances !== undefined && Number.isInteger(balances.decimals) && balances.decimals >= 0 && balances.decimals <= 255 ? balances : undefined
}

export function SavedShares({ decimals, yesAttoShares, noAttoShares, invalidAttoShares }: NonNullable<ReturnType<typeof decodeSharesBalance>>) {
	return (
		<SectionBlock title={pageCopy.savedHoldings}>
			<dl className='statoblast-saved-share-balances'>
				<div>
					<dt>{pageCopy.yes}</dt>
					<dd>
						<CurrencyValue value={yesAttoShares} units={decimals} />
					</dd>
				</div>
				<div>
					<dt>{pageCopy.no}</dt>
					<dd>
						<CurrencyValue value={noAttoShares} units={decimals} />
					</dd>
				</div>
				<div>
					<dt>{pageCopy.invalid}</dt>
					<dd>
						<CurrencyValue value={invalidAttoShares} units={decimals} />
					</dd>
				</div>
			</dl>
		</SectionBlock>
	)
}
