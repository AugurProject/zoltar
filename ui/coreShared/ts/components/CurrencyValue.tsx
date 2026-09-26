import * as commonCopy from '../copy/common.js'
import * as pricingCopy from '../copy/pricing.js'
import { LoadingText } from './LoadingText.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { formatAmount, formatCurrencyBalance, formatUnitSuffix, withApproximateMarker, type AmountNotation } from '../lib/formatters.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'
import { CopyErrorMessage } from './CopyErrorMessage.js'

type CurrencyValueProps = {
	/** Unit named in the title and copy button when a surrounding label shows it instead of `suffix`. */
	accessibleUnit?: string
	className?: string
	/** Renders the value as a copy button. Off by default so amounts are plain text; enable it only where copying the exact value is a real task, such as the header balances. */
	copyable?: boolean
	decimals?: number
	exactWhenRoundedToZero?: boolean
	loading?: boolean
	/** `compact` switches to SI suffixes from 1 000 (`1.2k`, `1T`) so dense surfaces render the same value identically at every width. */
	notation?: AmountNotation
	precision?: 'exact' | 'rounded'
	suffix?: string
	units?: number
	value: bigint | undefined
}

function getDisplayNumber({ decimals, exactWhenRoundedToZero, notation, precision, units, value }: { decimals: number; exactWhenRoundedToZero: boolean; notation: AmountNotation; precision: 'exact' | 'rounded'; units: number; value: bigint }) {
	if (precision === 'exact') return formatCurrencyBalance(value, units)
	const absoluteValue = value < 0n ? -value : value
	if (exactWhenRoundedToZero && absoluteValue < 10n ** BigInt(Math.max(units - decimals, 0))) return formatCurrencyBalance(value, units)
	return withApproximateMarker(formatAmount(value, { decimals, notation, units }))
}

export function CurrencyValue({ accessibleUnit, className = '', copyable = false, decimals = 2, exactWhenRoundedToZero = false, loading = false, notation = 'standard', precision = 'rounded', suffix = '', units = 18, value }: CurrencyValueProps) {
	const exactValue = value === undefined ? undefined : formatCurrencyBalance(value, units)
	const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(exactValue)

	if (loading) return <LoadingText className={`currency-value loading ${className}`}>{commonCopy.loadingWithEllipsis}</LoadingText>

	if (value === undefined || exactValue === undefined) return <span className={`currency-value unavailable ${className}`}>{getMetricPlaceholderPresentation(value)?.placeholder}</span>

	const exactSuffix = formatUnitSuffix(suffix)
	const renderedValue = (
		<span className='currency-value-number-unit'>
			{getDisplayNumber({ decimals, exactWhenRoundedToZero, notation, precision, units, value })}
			{exactSuffix}
		</span>
	)
	const titleUnit = suffix === '' ? accessibleUnit : suffix
	const exactTitle = `${exactValue}${formatUnitSuffix(titleUnit ?? '')}`

	if (!copyable)
		return (
			<span className='currency-value-wrap'>
				<span className={`currency-value ${className}`} title={exactTitle}>
					{renderedValue}
				</span>
			</span>
		)

	return (
		<span className='currency-value-wrap'>
			<button type='button' className={`currency-value copyable ${className}`} title={exactTitle} aria-label={pricingCopy.formatCopyExactCurrencyValue(exactTitle)} aria-describedby={copyError.value === undefined ? undefined : copyErrorId} onClick={() => copyText(exactValue)}>
				{copied.value ? <span className='copy-feedback'>{commonCopy.copied}</span> : renderedValue}
			</button>
			<CopyErrorMessage id={copyErrorId} manualValue={exactValue} message={copyError.value} />
		</span>
	)
}
