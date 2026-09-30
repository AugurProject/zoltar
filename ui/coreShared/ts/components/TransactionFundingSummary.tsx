import { CurrencyValue } from './CurrencyValue.js'
import * as commonCopy from '../copy/common.js'
import * as copy from '../copy/transactionSteps.js'
import { formatAmountDisplay, formatCurrencyBalance, formatValueWithUnit } from '../lib/formatters.js'
import type { TokenFundingAmount } from '../transactions/transactionSteps.js'

const FUNDING_DISPLAY_DECIMALS = 4

/** Amounts with more fractional digits than the funding summary shows are rounded; shorter ones stay exact. */
function hasHiddenFractionDigits(value: bigint, units: number) {
	return units > FUNDING_DISPLAY_DECIMALS && value % 10n ** BigInt(units - FUNDING_DISPLAY_DECIMALS) !== 0n
}

function formatFundingAmount({ amount, tokenSymbol, tokenUnits }: TokenFundingAmount) {
	const exact = formatCurrencyBalance(amount, tokenUnits)
	const display = hasHiddenFractionDigits(amount, tokenUnits) ? formatAmountDisplay(amount, { decimals: FUNDING_DISPLAY_DECIMALS, units: tokenUnits }) : exact
	return { display: formatValueWithUnit(display, tokenSymbol), exact: formatValueWithUnit(exact, tokenSymbol) }
}

export function EthAmount({ value }: { value: bigint | undefined }) {
	const needsRounding = value !== undefined && hasHiddenFractionDigits(value, 18)
	return <CurrencyValue precision={needsRounding ? 'rounded' : 'exact'} decimals={FUNDING_DISPLAY_DECIMALS} value={value} units={18} suffix={commonCopy.eth} />
}

export function TransactionFundingSummary({ funding, totalAttoEth, outcome }: { funding: readonly TokenFundingAmount[]; totalAttoEth: bigint | undefined; outcome?: { returnToWallet: boolean; settlerRewardAttoEth: bigint | undefined } | undefined }) {
	return (
		<section className='transaction-funding' aria-label={copy.depositAndReturn}>
			<div className='transaction-funding-summary'>
				<h4>{copy.depositAndReturn}</h4>
				<div className='transaction-deposits'>
					{funding.map((token, index) => {
						const { display, exact } = formatFundingAmount(token)
						return (
							<strong key={`${index}:${exact}`} title={exact}>
								{display}
							</strong>
						)
					})}
				</div>
				{outcome === undefined ? undefined : <p className='detail'>{outcome.returnToWallet ? copy.coordinatorReturnDetail : copy.standaloneReturnDetail}</p>}
			</div>
			<div className='transaction-funding-summary'>
				<dl className='transaction-costs'>
					<div>
						<dt>{copy.totalEth}</dt>
						<dd>
							<EthAmount value={totalAttoEth} />
						</dd>
					</div>
					{outcome === undefined ? undefined : (
						<div>
							<dt>{copy.settlementBounty}</dt>
							<dd>
								<EthAmount value={outcome.settlerRewardAttoEth} />
							</dd>
						</div>
					)}
				</dl>
			</div>
		</section>
	)
}
