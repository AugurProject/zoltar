import * as commonCopy from '../copy/common.js'
import { shouldDisplayMaxTokenApprovalAmount } from '../transactions/tokenApproval.js'
import { CurrencyValue } from './CurrencyValue.js'

type ApprovedAmountValueProps = {
	className?: string
	copyable?: boolean
	decimals?: number
	loading?: boolean
	requiredAmount?: bigint | undefined
	suffix?: string
	units?: number
	value: bigint | undefined
}

function getApprovedAmountTone(value: bigint | undefined, requiredAmount: bigint | undefined) {
	if (value === undefined || requiredAmount === undefined) return undefined
	return value >= requiredAmount ? 'sufficient' : 'insufficient'
}

export function ApprovedAmountValue({ className = '', copyable = true, decimals = 2, loading = false, requiredAmount, suffix = '', units = 18, value }: ApprovedAmountValueProps) {
	const toneClassName = getApprovedAmountTone(value, requiredAmount)

	if (shouldDisplayMaxTokenApprovalAmount(value))
		return (
			<span className={['currency-value', 'approval-max', toneClassName === undefined ? '' : `approval-${toneClassName}`, className].filter(Boolean).join(' ')} title={commonCopy.unlimitedApproval}>
				{commonCopy.max}
			</span>
		)

	return <CurrencyValue className={[toneClassName === undefined ? '' : `approval-${toneClassName}`, className].filter(Boolean).join(' ')} copyable={copyable} decimals={decimals} loading={loading} suffix={suffix} units={units} value={value} />
}
