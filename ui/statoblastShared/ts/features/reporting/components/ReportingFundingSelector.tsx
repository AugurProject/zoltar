import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import * as reportingCopy from '../../../copy/reporting.js'

type FundingSource = 'wallet' | 'vault'

export function ReportingFundingSelector({ value, onChange, disabled }: { value: FundingSource; onChange: (value: FundingSource) => void; disabled: boolean }) {
	return (
		<ViewTabs
			ariaLabel={reportingCopy.repSource}
			variant='segmented'
			value={value}
			onChange={onChange}
			options={[
				{ value: 'wallet', label: reportingCopy.walletRepSource, disabled },
				{ value: 'vault', label: reportingCopy.vaultRepSource, disabled },
			]}
		/>
	)
}

export function ReportingWalletVaultHelp({ depositAmount, reportAmount, remainingAmount }: { remainingAmount: bigint | undefined; depositAmount: bigint | undefined; reportAmount: bigint | undefined }) {
	return (
		<p className='detail'>
			{reportingCopy.continuationFundingHelp}
			{depositAmount !== undefined && reportAmount !== undefined && remainingAmount !== undefined && depositAmount > reportAmount ? ` ${reportingCopy.continuationMinimumDeposit(formatCurrencyBalance(depositAmount), formatCurrencyBalance(remainingAmount))}` : ''}
		</p>
	)
}
