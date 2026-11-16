import * as commonCopy from '../copy/common.js'
import { shouldDisplayMaxTokenApprovalAmount } from '../transactions/tokenApproval.js'
import { CurrencyValue } from './CurrencyValue.js'

type ApprovedAmountValueProps = {
	className?: string
	decimals?: number
	loading?: boolean
	precision?: 'exact' | 'rounded'
	requiredAmount?: bigint | undefined
	suffix?: string
	units?: number
	value: bigint | undefined
}

function getApprovedAmountTone(value: bigint | undefined, requiredAmount: bigint | undefined) {
	if (value === undefined || requiredAmount === undefined) return undefined
	return value >= requiredAmount ? 'sufficient' : 'insufficient'
}

export function ApprovedAmountValue({ className = '', decimals = 2, loading = false, precision = 'rounded', requiredAmount, suffix = '', units = 18, value }: ApprovedAmountValueProps) {
	const toneClassName = getApprovedAmountTone(value, requiredAmount)

	if (shouldDisplayMaxTokenApprovalAmount(value))
		return (
			<span className={['currency-value', 'approval-max', toneClassName === undefined ? '' : `approval-${toneClassName}`, className].filter(Boolean).join(' ')} title={commonCopy.unlimitedApproval}>
				{commonCopy.max}
			</span>
		)

	return <CurrencyValue className={[toneClassName === undefined ? '' : `approval-${toneClassName}`, className].filter(Boolean).join(' ')} decimals={decimals} precision={precision} loading={loading} suffix={suffix} units={units} value={value} />
}
