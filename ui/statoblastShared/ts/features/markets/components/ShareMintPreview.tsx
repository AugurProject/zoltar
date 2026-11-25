import { AmountField } from '@zoltar/ui-core-shared/components/AmountField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as copy from '../../../copy/trading.js'
import type { TradingFormState } from '../../../types/app.js'
import type { TradingShareBalances } from '../../../types/contracts.js'
import type { useTradingCollateral } from '../hooks/useTradingCollateral.js'
import type { useTradingOperations } from '../hooks/useTradingOperations.js'

type ShareMintPreviewProps = {
	funding: ReturnType<typeof useTradingCollateral> | undefined
	limits: ReturnType<typeof useTradingOperations>['mintLimits'] | undefined
	balances: TradingShareBalances | undefined
	form: TradingFormState
	onChange: (update: Partial<TradingFormState>) => void
}

export function ShareMintGlyph({ funding }: Pick<ShareMintPreviewProps, 'funding'>) {
	const quote = funding?.mintQuote
	const collateral = funding?.collateral
	if (quote === undefined || collateral === undefined) return undefined
	const amount = (value: bigint, suffix: string) => <CurrencyValue value={value} units={collateral.decimals} decimals={4} suffix={suffix} exactWhenRoundedToZero />
	return (
		<div className='statoblast-share-mint-glyph'>
			{amount(quote.amount, collateral.symbol)} <span aria-hidden='true'>→</span> {amount(quote.shares, commonCopy.yes)} <span aria-hidden='true'>+</span> {amount(quote.shares, commonCopy.no)} <span aria-hidden='true'>+</span> {amount(quote.shares, commonCopy.invalid)}
		</div>
	)
}

export function ShareMintPreview({ funding, limits, balances, form, onChange }: ShareMintPreviewProps) {
	const quote = funding?.mintQuote
	const collateral = funding?.collateral
	if (quote === undefined || collateral === undefined) return undefined
	const { decimals, symbol, balance } = collateral
	const { amount, capacity, fee, shares } = quote
	const total = amount + fee
	const currency = (value: bigint, unit?: string) => <CurrencyValue value={value} units={decimals} decimals={4} {...(unit === undefined ? {} : { suffix: unit })} exactWhenRoundedToZero />
	const outcomes = [
		{ label: commonCopy.yes, balance: balances?.yesAttoShares },
		{ label: commonCopy.no, balance: balances?.noAttoShares },
		{ label: commonCopy.invalid, balance: balances?.invalidAttoShares },
	]
	const shareRows = balances?.yesAttoShares === balances?.noAttoShares && balances?.yesAttoShares === balances?.invalidAttoShares ? [{ label: copy.sharesOfEachOutcome, balance: balances?.yesAttoShares }] : outcomes.map(outcome => ({ label: copy.formatOutcomeShares(outcome.label), balance: outcome.balance }))
	const comparison = (label: string, before: bigint | undefined, after: bigint | undefined, unit?: string) => {
		if (before === undefined || after === undefined) return undefined
		return (
			<div key={label}>
				<dt>{label}</dt>
				<dd>
					{currency(before, unit)} → {currency(after, unit)}
				</dd>
			</div>
		)
	}
	return (
		<>
			<details className='statoblast-share-mint-limits'>
				<summary>
					{copy.limits} · {copy.formatMintLimits(formatCurrencyInputBalance(limits?.maximumFee ?? quote.maximumFee, decimals), symbol, formatCurrencyInputBalance(limits?.minimumShares ?? quote.minimumShares, decimals))}
				</summary>
				<div className='statoblast-share-mint-limits-fields'>
					<AmountField allowZero label={copy.maximumMintFee} value={form.mintMaximumFee ?? ''} onChange={mintMaximumFee => onChange({ mintMaximumFee })} decimals={decimals} unit={symbol} placeholder={formatCurrencyInputBalance(quote.maximumFee, decimals)} />
					<AmountField allowZero label={copy.minimumMintShares} value={form.mintMinimumShares ?? ''} onChange={mintMinimumShares => onChange({ mintMinimumShares })} decimals={decimals} unit={copy.setsUnit} placeholder={formatCurrencyInputBalance(quote.minimumShares, decimals)} />
				</div>
			</details>
			<div className='statoblast-share-mint-details'>
				<dl className='statoblast-share-mint-rows'>
					<div>
						<dt>{copy.mintCollateral}</dt>
						<dd>{currency(amount, symbol)}</dd>
					</div>
					<div>
						<dt>{copy.mintFee}</dt>
						<dd>{currency(fee, symbol)}</dd>
					</div>
					<div>
						<dt>{copy.youPay}</dt>
						<dd>{currency(total, symbol)}</dd>
					</div>
				</dl>
				<dl className='statoblast-share-mint-rows'>
					{shareRows.map(({ label, balance: sharesBefore }) => comparison(label, sharesBefore, sharesBefore === undefined ? undefined : sharesBefore + shares))}
					{comparison(copy.formatMintWallet(symbol), balance, balance === undefined || balance < total ? undefined : balance - total, symbol)}
					{comparison(copy.freeMintCapacity, capacity, capacity === undefined || capacity < amount ? undefined : capacity - amount, symbol)}
				</dl>
			</div>
		</>
	)
}
