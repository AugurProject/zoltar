import * as commonCopy from '../copy/common.js'
import * as pricingCopy from '../copy/pricing.js'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { LoadingText } from './LoadingText.js'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js'
import { formatCompactCurrencyBalance, formatCurrencyBalance, formatRoundedCurrencyBalance } from '../lib/formatters.js'
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js'
import { CopyErrorMessage } from './CopyErrorMessage.js'

type CurrencyValueProps = {
	className?: string
	compactWhenOverflow?: boolean
	decimals?: number
	loading?: boolean
	copyable?: boolean
	exactWhenRoundedToZero?: boolean
	precision?: 'exact' | 'rounded'
	suffix?: string
	units?: number
	value: bigint | undefined
}

function parsePixels(value: string) {
	const pixels = Number.parseFloat(value)
	return Number.isFinite(pixels) ? pixels : 0
}

function isInlineLevel(element: Element) {
	const display = getComputedStyle(element).display
	return display === '' || display === 'inline' || display === 'contents' || display.startsWith('inline-')
}

/**
 * The value and its wrap shrink to fit their text (and a flex item reports `display: block` even when styled inline),
 * so the room for the full value is the nearest block container above the component's own wrap.
 */
function getLayoutContainer(element: HTMLElement) {
	const wrap = element.parentElement
	let container = wrap?.parentElement ?? element
	while (container.parentElement !== null && isInlineLevel(container)) container = container.parentElement
	return container
}

/** Width available to the text: excludes the container padding and the element's own padding, which the measurement span lacks. */
function getAvailableWidth(element: HTMLElement, container: HTMLElement) {
	const containerStyle = getComputedStyle(container)
	const elementStyle = getComputedStyle(element)
	return container.clientWidth - parsePixels(containerStyle.paddingLeft) - parsePixels(containerStyle.paddingRight) - parsePixels(elementStyle.paddingLeft) - parsePixels(elementStyle.paddingRight)
}

export function CurrencyValue({ className = '', compactWhenOverflow = false, copyable = true, decimals = 2, exactWhenRoundedToZero = false, loading = false, precision = 'rounded', suffix = '', units = 18, value }: CurrencyValueProps) {
	const buttonRef = useRef<HTMLButtonElement>(null)
	const spanRef = useRef<HTMLSpanElement>(null)
	const measureRef = useRef<HTMLSpanElement>(null)
	const [shouldCompact, setShouldCompact] = useState(false)
	const exactValue = value === undefined ? undefined : formatCurrencyBalance(value, units)
	const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(exactValue)
	const copiedValue = copied.value
	const exactSuffix = suffix === '' ? '' : ` ${suffix}`

	let displayNumber: string | undefined
	let compactDisplayNumber: string | undefined
	if (value !== undefined && exactValue !== undefined) {
		if (precision === 'exact') {
			displayNumber = exactValue
			compactDisplayNumber = displayNumber
		} else {
			const roundedValue = formatRoundedCurrencyBalance(value, units, decimals)
			const zeroThreshold = 10n ** BigInt(Math.max(units - decimals, 0))
			const absoluteValue = value < 0n ? -value : value
			const useExactValue = exactWhenRoundedToZero && absoluteValue < zeroThreshold
			displayNumber = useExactValue ? exactValue : `≈ ${roundedValue}`
			compactDisplayNumber = useExactValue ? exactValue : `≈ ${formatCompactCurrencyBalance(value, units)}`
		}
	}
	const displayValue = displayNumber === undefined ? undefined : `${displayNumber}${exactSuffix}`

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

		const container = getLayoutContainer(element)
		const updateCompaction = () => {
			if (copied.value) return
			const availableWidth = getAvailableWidth(element, container)
			// A hidden value has no width to judge; keep the current choice until the container is shown.
			if (availableWidth <= 0) return
			measureElement.textContent = displayValue
			const shouldUseCompactValue = measureElement.getBoundingClientRect().width > availableWidth + 1
			measureElement.textContent = ''
			setShouldCompact(shouldUseCompactValue)
		}

		updateCompaction()

		if (typeof ResizeObserver === 'undefined') return

		const observer = new ResizeObserver(() => {
			updateCompaction()
		})
		observer.observe(container)

		return () => {
			observer.disconnect()
		}
	}, [compactWhenOverflow, copiedValue, displayValue, loading, value])

	if (loading) return <LoadingText className={`currency-value loading ${className}`}>{commonCopy.loadingWithEllipsis}</LoadingText>

	if (value === undefined || exactValue === undefined || displayValue === undefined || displayNumber === undefined || compactDisplayNumber === undefined) return <span className={`currency-value unavailable ${className}`}>{getMetricPlaceholderPresentation(value)?.placeholder}</span>

	const resolvedDisplayNumber = compactWhenOverflow && shouldCompact && !copiedValue ? compactDisplayNumber : displayNumber
	const renderedValue = (
		<span className='currency-value-number-unit'>
			{resolvedDisplayNumber}
			{exactSuffix}
		</span>
	)
	const exactTitle = `${exactValue}${exactSuffix}`
	const valueClassName = `currency-value${copyable ? ' copyable' : ''} ${className}`
	const measureClassName = `currency-value currency-value-measure ${className}`

	if (!copyable)
		return (
			<span className='currency-value-wrap'>
				<span ref={spanRef} className={valueClassName} title={exactTitle}>
					{renderedValue}
				</span>
				<span ref={measureRef} aria-hidden='true' className={measureClassName} />
			</span>
		)

	return (
		<span className='currency-value-wrap'>
			<button ref={buttonRef} type='button' className={valueClassName} title={exactTitle} aria-label={pricingCopy.formatCopyExactCurrencyValue(exactValue)} aria-describedby={copyError.value === undefined ? undefined : copyErrorId} onClick={() => copyText(exactValue)}>
				{copiedValue ? <span className='copy-feedback'>{commonCopy.copied}</span> : renderedValue}
			</button>
			<CopyErrorMessage id={copyErrorId} manualValue={exactValue} message={copyError.value} />
			<span ref={measureRef} aria-hidden='true' className={measureClassName} />
		</span>
	)
}
