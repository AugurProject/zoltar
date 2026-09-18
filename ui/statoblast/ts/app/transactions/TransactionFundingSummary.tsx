import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as copy from '../../copy/transactionSteps.js'

export function EthAmount({ value }: { value: bigint | undefined }) {
	const useNanoEth = value !== undefined && value > 0n && value < 10n ** 15n
	return <CurrencyValue precision='exact' copyable={false} value={value} units={useNanoEth ? 9 : 18} suffix={useNanoEth ? copy.nanoEth : commonCopy.eth} />
}

export function TransactionFundingSummary({ funding, totalAttoEth, outcome }: { funding: readonly { amount: string }[]; totalAttoEth: bigint | undefined; outcome?: { returnToWallet: boolean; settlerRewardAttoEth: bigint | undefined; ethRefundAttoEth: bigint | undefined } | undefined }) {
	return (
		<section className='transaction-funding' aria-label={copy.depositAndReturn}>
			<div className='transaction-funding-summary'>
				<h4>{copy.depositAndReturn}</h4>
				<div className='transaction-deposits'>
					{funding.map(token => (
						<strong key={token.amount}>{token.amount}</strong>
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
						<>
							<div>
								<dt>{copy.settlementBounty}</dt>
								<dd>
									<EthAmount value={outcome.settlerRewardAttoEth} />
								</dd>
							</div>
							<div>
								<dt>{copy.ethRefund}</dt>
								<dd>
									<EthAmount value={outcome.ethRefundAttoEth} />
								</dd>
							</div>
						</>
					)}
				</dl>
				{outcome === undefined ? undefined : <p className='detail'>{copy.settlementCostDetail}</p>}
			</div>
		</section>
	)
}
