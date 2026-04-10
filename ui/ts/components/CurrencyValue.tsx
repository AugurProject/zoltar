import { useEffect } from 'preact/hooks'
import { LoadingText } from './LoadingText.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { formatCurrencyBalance, formatRoundedCurrencyBalance } from '../lib/formatters.js'

type CurrencyValueProps = {
	className?: string
	decimals?: number
	loading?: boolean
	copyable?: boolean
	suffix?: string
	units?: number
	value: bigint | undefined
}

export function CurrencyValue({ className = '', copyable = true, decimals = 2, loading = false, suffix = '', units = 18, value }: CurrencyValueProps) {
	const { copied, copyText } = useCopyToClipboard()
	const exactValue = value === undefined ? undefined : formatCurrencyBalance(value, units)
	const exactSuffix = suffix === '' ? '' : ` ${suffix}`

	useEffect(() => {
		copied.value = false
	}, [exactValue])

	if (loading) {
		return <LoadingText className={`currency-value loading ${className}`}>Loading...</LoadingText>
	}

	if (value === undefined) {
		return <span className={`currency-value unavailable ${className}`}>Unavailable</span>
	}

	const resolvedExactValue = exactValue ?? formatCurrencyBalance(value, units)
	const roundedValue = formatRoundedCurrencyBalance(value, units, decimals)
	const displayValue = `≈ ${roundedValue}${exactSuffix}`
	const exactTitle = `${resolvedExactValue}${exactSuffix}`
	const valueClassName = `currency-value${copyable ? ' copyable' : ''} ${className}`

	if (!copyable) {
		return (
			<span className={valueClassName} title={exactTitle}>
				{displayValue}
			</span>
		)
	}

	return (
		<button type='button' className={valueClassName} title={exactTitle} aria-label={`Copy exact value ${resolvedExactValue}`} onClick={() => copyText(resolvedExactValue)}>
			{copied.value ? 'Copied' : displayValue}
		</button>
	)
}
