import { useSignal } from '@preact/signals'
import { LoadingText } from './LoadingText.js'
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
	const copied = useSignal(false)

	if (loading) {
		return <LoadingText className={`currency-value loading ${className}`}>Loading...</LoadingText>
	}

	if (value === undefined) {
		return <span className={`currency-value unavailable ${className}`}>Unavailable</span>
	}

	const exactValue = formatCurrencyBalance(value, units)
	const roundedValue = formatRoundedCurrencyBalance(value, units, decimals)
	const displayValue = suffix === '' ? `≈ ${roundedValue}` : `≈ ${roundedValue} ${suffix}`
	const valueClassName = `currency-value${copyable ? ' copyable' : ''} ${className}`

	if (!copyable) {
		return (
			<span className={valueClassName} title={suffix === '' ? exactValue : `${exactValue} ${suffix}`}>
				{displayValue}
			</span>
		)
	}

	return (
		<button
			type='button'
			className={valueClassName}
			title={suffix === '' ? exactValue : `${exactValue} ${suffix}`}
			aria-label={`Copy exact value ${exactValue}`}
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(exactValue)
					copied.value = true
					window.setTimeout(() => {
						copied.value = false
					}, 1200)
				} catch {
					return
				}
			}}
		>
			{copied.value ? 'Copied' : displayValue}
		</button>
	)
}
