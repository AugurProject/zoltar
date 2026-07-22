import * as commonCopy from '../copy/common.js'
import * as pricingCopy from '../copy/pricing.js'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { LoadingText } from './LoadingText.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { formatCompactCurrencyBalance, formatCurrencyBalance, formatRoundedCurrencyBalance } from '../lib/formatters.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'

type CurrencyValueProps = {
	className?: string
	compactWhenOverflow?: boolean
	decimals?: number
	loading?: boolean
	copyable?: boolean
	precision?: 'exact' | 'rounded'
	suffix?: string
	units?: number
	value: bigint | undefined
}

export function CurrencyValue({ className = '', compactWhenOverflow = false, copyable = true, decimals = 2, loading = false, precision = 'rounded', suffix = '', units = 18, value }: CurrencyValueProps) {
	const { copied, copyText } = useCopyToClipboard()
	const buttonRef = useRef<HTMLButtonElement>(null)
	const spanRef = useRef<HTMLSpanElement>(null)
	const measureRef = useRef<HTMLSpanElement>(null)
	const [shouldCompact, setShouldCompact] = useState(false)
	const copiedValue = copied.value
	const exactValue = value === undefined ? undefined : formatCurrencyBalance(value, units)
	const exactSuffix = suffix === '' ? '' : ` ${suffix}`

	useEffect(() => {
		copied.value = false
	}, [exactValue])

	let displayValue: string | undefined
	let compactDisplayValue: string | undefined
	if (value !== undefined && exactValue !== undefined) {
		if (precision === 'exact') {
			displayValue = `${exactValue}${exactSuffix}`
			compactDisplayValue = displayValue
		} else {
			displayValue = `≈ ${formatRoundedCurrencyBalance(value, units, decimals)}${exactSuffix}`
			compactDisplayValue = `≈ ${formatCompactCurrencyBalance(value, units)}${exactSuffix}`
		}
	}

	useLayoutEffect(() => {
		if (!compactWhenOverflow || value === undefined || displayValue === undefined) {
			setShouldCompact(false)
			return
		}

		const element = buttonRef.current ?? spanRef.current
		const measureElement = measureRef.current
		if (element === null || measureElement === null) {
			setShouldCompact(false)
			return
		}

		const updateCompaction = () => {
			if (copied.value) return
			measureElement.textContent = displayValue
			const shouldUseCompactValue = measureElement.getBoundingClientRect().width > element.clientWidth + 1
			measureElement.textContent = ''
			setShouldCompact(shouldUseCompactValue)
		}

		updateCompaction()

		if (typeof ResizeObserver === 'undefined') return

		const observer = new ResizeObserver(() => {
			updateCompaction()
		})
		observer.observe(element)

		return () => {
			observer.disconnect()
		}
	}, [compactWhenOverflow, copiedValue, displayValue, value])

	if (loading) return <LoadingText className={`currency-value loading ${className}`}>{commonCopy.loadingWithEllipsis}</LoadingText>

	if (value === undefined || exactValue === undefined || displayValue === undefined || compactDisplayValue === undefined) return <span className={`currency-value unavailable ${className}`}>{getMetricPlaceholderPresentation(value)?.placeholder}</span>

	const resolvedDisplayValue = compactWhenOverflow && shouldCompact && !copiedValue ? compactDisplayValue : displayValue
	const exactTitle = `${exactValue}${exactSuffix}`
	const valueClassName = `currency-value${copyable ? ' copyable' : ''} ${className}`
	const measureClassName = `currency-value currency-value-measure ${className}`

	if (!copyable)
		return (
			<span className='currency-value-wrap'>
				<span ref={spanRef} className={valueClassName} title={exactTitle}>
					{resolvedDisplayValue}
				</span>
				<span ref={measureRef} aria-hidden='true' className={measureClassName} />
			</span>
		)

	return (
		<span className='currency-value-wrap'>
			<button ref={buttonRef} type='button' className={valueClassName} title={exactTitle} aria-label={pricingCopy.formatCopyExactCurrencyValue(exactValue)} onClick={() => copyText(exactValue)}>
				{copiedValue ? commonCopy.copied : resolvedDisplayValue}
			</button>
			<span ref={measureRef} aria-hidden='true' className={measureClassName} />
		</span>
	)
}
