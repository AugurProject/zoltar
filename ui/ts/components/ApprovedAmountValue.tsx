import { CurrencyValue } from './CurrencyValue.js'

export const APPROVAL_MAX_DISPLAY_THRESHOLD = (1n << 200n) - 1n

type ApprovedAmountValueProps = {
	className?: string
	copyable?: boolean
	decimals?: number
	loading?: boolean
	suffix?: string
	units?: number
	value: bigint | undefined
}

export function isApprovalAmountMaxDisplay(value: bigint | undefined) {
	return value !== undefined && value > APPROVAL_MAX_DISPLAY_THRESHOLD
}

export function ApprovedAmountValue({ className = '', copyable = true, decimals = 2, loading = false, suffix = '', units = 18, value }: ApprovedAmountValueProps) {
	if (isApprovalAmountMaxDisplay(value)) {
		return (
			<span className={`currency-value approval-max ${className}`.trim()} title='Unlimited approval'>
				max
			</span>
		)
	}

	return <CurrencyValue className={className} copyable={copyable} decimals={decimals} loading={loading} suffix={suffix} units={units} value={value} />
}
