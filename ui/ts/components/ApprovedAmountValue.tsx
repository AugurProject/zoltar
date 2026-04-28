import { CurrencyValue } from './CurrencyValue.js'

export const APPROVAL_MAX_DISPLAY_THRESHOLD = (1n << 200n) - 1n
export const APPROVAL_MAX_LABEL = 'Max'

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

export function isApprovalAmountMaxDisplay(value: bigint | undefined) {
	return value !== undefined && value > APPROVAL_MAX_DISPLAY_THRESHOLD
}

export function getApprovedAmountTone(value: bigint | undefined, requiredAmount: bigint | undefined) {
	if (value === undefined || requiredAmount === undefined) return undefined
	return value >= requiredAmount ? 'sufficient' : 'insufficient'
}

export function ApprovedAmountValue({ className = '', copyable = true, decimals = 2, loading = false, requiredAmount, suffix = '', units = 18, value }: ApprovedAmountValueProps) {
	const toneClassName = getApprovedAmountTone(value, requiredAmount)

	if (isApprovalAmountMaxDisplay(value)) {
		return (
			<span className={['currency-value', 'approval-max', toneClassName === undefined ? '' : `approval-${toneClassName}`, className].filter(Boolean).join(' ')} title='Unlimited approval'>
				{APPROVAL_MAX_LABEL}
			</span>
		)
	}

	return <CurrencyValue className={[toneClassName === undefined ? '' : `approval-${toneClassName}`, className].filter(Boolean).join(' ')} copyable={copyable} decimals={decimals} loading={loading} suffix={suffix} units={units} value={value} />
}
