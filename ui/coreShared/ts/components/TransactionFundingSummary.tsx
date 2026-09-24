import { CurrencyValue } from './CurrencyValue.js'
import * as commonCopy from '../copy/common.js'
import * as copy from '../copy/transactionSteps.js'
import { formatCurrencyBalance, formatRoundedCurrencyBalance } from '../lib/formatters.js'

function formatFundingAmount(amount: string) {
	const match = /^(-?\d+)(?:\.(\d+))?(\s+\S+)$/.exec(amount)
	if (match === null) return amount
	const [, whole, fraction, unit] = match
	if (whole === undefined || fraction === undefined || unit === undefined || fraction.length <= 4) return amount
	const value = BigInt(`${whole}${fraction}`)
	return `≈ ${formatRoundedCurrencyBalance(value, fraction.length, 4)}${unit}`
}

export function EthAmount({ value }: { value: bigint | undefined }) {
	const exact = formatCurrencyBalance(value, 18)
	const needsRounding = (exact.split('.')[1]?.length ?? 0) > 4
	return <CurrencyValue precision={needsRounding ? 'rounded' : 'exact'} decimals={4} copyable={false} value={value} units={18} suffix={commonCopy.eth} />
}

export function TransactionFundingSummary({ funding, totalAttoEth, outcome }: { funding: readonly { amount: string }[]; totalAttoEth: bigint | undefined; outcome?: { returnToWallet: boolean; settlerRewardAttoEth: bigint | undefined } | undefined }) {
	const orderedFunding = funding.length === 2 && funding.some(token => token.amount.endsWith('WETH')) && funding.some(token => token.amount.endsWith('REP')) ? [...funding].sort((left, right) => Number(right.amount.endsWith('WETH')) - Number(left.amount.endsWith('WETH'))) : funding
	return (
		<section className='transaction-funding' aria-label={copy.depositAndReturn}>
			<div className='transaction-funding-summary'>
				<h4>{copy.depositAndReturn}</h4>
				<div className='transaction-deposits'>
					{orderedFunding.map(token => (
						<strong key={token.amount} title={token.amount}>
							{formatFundingAmount(token.amount)}
						</strong>
					))}
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
				{outcome === undefined ? undefined : <p className='detail'>{copy.settlementCostDetail}</p>}
			</div>
		</section>
	)
}
