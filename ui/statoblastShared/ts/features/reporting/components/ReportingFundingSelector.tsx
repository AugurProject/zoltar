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
