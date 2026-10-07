import * as commonCopy from '../copy/common.js'
import * as pricingCopy from '../copy/pricing.js'
import { LoadingText } from './LoadingText.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { formatAmount, formatCurrencyBalance, formatUnitSuffix, toPlainGrouping, withApproximateMarker, type AmountNotation, type AmountRounding } from '../lib/formatters.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'
import { CopyErrorMessage } from './CopyErrorMessage.js'
import { CopyGlyph, CopyStatus } from './CopyStatus.js'

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
	/** `down` keeps a rounded figure at or below the exact value, for limits a user may type back. It forces standard notation, overriding `notation: 'compact'`. */
	rounding?: AmountRounding
	suffix?: string
	units?: number
	value: bigint | undefined
}

function getDisplayNumber({ decimals, exactWhenRoundedToZero, notation, precision, rounding, units, value }: { decimals: number; exactWhenRoundedToZero: boolean; notation: AmountNotation; precision: 'exact' | 'rounded'; rounding: AmountRounding; units: number; value: bigint }) {
	if (precision === 'exact') return { approximate: false, text: formatCurrencyBalance(value, units) }
	const absoluteValue = value < 0n ? -value : value
	if (exactWhenRoundedToZero && absoluteValue < 10n ** BigInt(Math.max(units - decimals, 0))) return { approximate: false, text: formatCurrencyBalance(value, units) }
	const formatted = formatAmount(value, { decimals, notation, rounding, units })
	return { approximate: formatted.approximate, text: withApproximateMarker(formatted) }
}

export function CurrencyValue({ accessibleUnit, className = '', copyable = false, decimals = 2, exactWhenRoundedToZero = false, loading = false, notation = 'standard', precision = 'rounded', rounding = 'nearest', suffix = '', units = 18, value }: CurrencyValueProps) {
	const exactValue = value === undefined ? undefined : formatCurrencyBalance(value, units)
	// Copied text uses ordinary spaces so pasting it elsewhere never carries the no-break grouping separator.
	const copyValue = exactValue === undefined ? undefined : toPlainGrouping(exactValue)
	const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(copyValue)

	// A section can hold many loading values, so each spinner stays silent instead of being its own live region.
	if (loading)
		return (
			<LoadingText announce={false} className={`currency-value loading ${className}`}>
				{commonCopy.loadingWithEllipsis}
			</LoadingText>
		)

	if (value === undefined || exactValue === undefined || copyValue === undefined) return <span className={`currency-value unavailable ${className}`}>{getMetricPlaceholderPresentation(value)?.placeholder}</span>

	const exactSuffix = formatUnitSuffix(suffix)
	const displayNumber = getDisplayNumber({ decimals, exactWhenRoundedToZero, notation, precision, rounding, units, value })
	const renderedValue = (
		<span className='currency-value-number-unit'>
			{displayNumber.text}
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
				{/* The title only reaches mouse users, so screen readers also get the exact value of a rounded amount. */}
				{displayNumber.approximate ? <span className='visually-hidden'>{commonCopy.formatExactValueLabel(exactTitle)}</span> : undefined}
			</span>
		)

	return (
		<span className='currency-value-wrap'>
			<button type='button' className={`currency-value copyable ${className}`} data-copied={copied.value} title={exactTitle} aria-label={pricingCopy.formatCopyExactCurrencyValue(exactTitle)} aria-describedby={copyError.value === undefined ? undefined : copyErrorId} onClick={() => copyText(copyValue)}>
				{renderedValue}
				<CopyGlyph />
			</button>
			<CopyStatus copied={copied.value} message={commonCopy.copied} />
			<CopyErrorMessage id={copyErrorId} manualValue={copyValue} message={copyError.value} />
		</span>
	)
}
