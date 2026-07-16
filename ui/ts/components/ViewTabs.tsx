import type { ViewTabOption, ViewTabsProps } from '../types/components.js'
import { useEffect, useRef, useState } from 'preact/hooks'

type IndexedViewTabOption<TValue extends string> = {
	index: number
	option: ViewTabOption<TValue>
}

type ViewTabGroup<TValue extends string> = {
	ariaLabel: string
	className?: string
	options: IndexedViewTabOption<TValue>[]
}

function buildGroupedOptions<TValue extends string>(groups: ViewTabsProps<TValue>['groups'], indexedOptions: IndexedViewTabOption<TValue>[]): ViewTabGroup<TValue>[] | undefined {
	if (groups === undefined) return undefined
	const optionsByValue = new Map(indexedOptions.map(option => [option.option.value, option]))
	const renderedValues = new Set<TValue>()
	return groups.map(group => {
		const groupedOptions = group.values.flatMap(groupValue => {
			if (renderedValues.has(groupValue)) return []
			const option = optionsByValue.get(groupValue)
			if (option === undefined) return []
			renderedValues.add(groupValue)
			return [option]
		})
		if (group.className === undefined) return { ariaLabel: group.ariaLabel, options: groupedOptions }
		return { ariaLabel: group.ariaLabel, className: group.className, options: groupedOptions }
	})
}

export function ViewTabs<TValue extends string>({ ariaLabel, className = '', groups, onChange, options, orientation = 'horizontal', semantics, size = 'default', value, variant = 'subroute' }: ViewTabsProps<TValue>) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [overflowEdges, setOverflowEdges] = useState({ end: false, start: false })
	const indexedOptions = options.map((option, index) => ({ index, option }))
	const resolvedSemantics = semantics ?? (options.every(option => option.panelId !== undefined) ? 'tabs' : 'switcher')
	const groupedOptions = buildGroupedOptions(groups, indexedOptions)
	const renderedOptions = groupedOptions === undefined ? indexedOptions : groupedOptions.flatMap(group => group.options)
	const moveSelection = (currentIndex: number, direction: 'next' | 'previous' | 'first' | 'last') => {
		const enabledOptions = renderedOptions.filter(({ option }) => option.disabled !== true)
		if (enabledOptions.length === 0) return undefined
		if (direction === 'first') return enabledOptions[0]
		if (direction === 'last') return enabledOptions[enabledOptions.length - 1]
		const enabledIndex = enabledOptions.findIndex(option => option.index === currentIndex)
		if (enabledIndex === -1) return enabledOptions[0]
		const nextIndex = direction === 'next' ? (enabledIndex + 1) % enabledOptions.length : (enabledIndex - 1 + enabledOptions.length) % enabledOptions.length
		return enabledOptions[nextIndex]
	}
	const handleKeyDown = (currentIndex: number, event: KeyboardEvent) => {
		const navigationKey = (() => {
			if (event.key === (orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight')) return 'next'
			if (event.key === (orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft')) return 'previous'

			return (() => {
				if (event.key === 'Home') return 'first'
				if (event.key === 'End') return 'last'

				return undefined
			})()
		})()
		if (navigationKey === undefined) return
		const targetOption = moveSelection(currentIndex, navigationKey)
		if (targetOption === undefined) return
		event.preventDefault()
		onChange(targetOption.option.value)
		const nextTabId = targetOption.option.id ?? `${ariaLabel.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-${String(targetOption.option.value).toLowerCase()}-tab`
		const nextTab = document.getElementById(nextTabId)
		if (nextTab instanceof HTMLElement) nextTab.focus()
	}
	const renderOption = (option: ViewTabOption<TValue>, index: number) => {
		const active = option.value === value
		const tabId = option.id ?? `${ariaLabel.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-${String(option.value).toLowerCase()}-tab`
		const sharedProps = {
			className: `view-tab ${active ? 'active' : ''}`.trim(),
			id: tabId,
			'aria-description': option.reason,
			title: option.reason,
			onClick: (event: MouseEvent) => {
				if (option.disabled) return
				if (option.href !== undefined && (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return
				onChange(option.value)
			},
			onKeyDown: resolvedSemantics === 'navigation' ? undefined : (event: KeyboardEvent) => handleKeyDown(index, event),
		} as const
		const semanticProps = (() => {
			if (resolvedSemantics === 'navigation') return { 'aria-current': active ? ('page' as const) : undefined }
			if (resolvedSemantics === 'tabs') return { 'aria-controls': option.panelId, 'aria-selected': active, role: 'tab' as const, tabIndex: active ? 0 : -1 }
			return { 'aria-pressed': active }
		})()
		const commonProps = { ...sharedProps, ...semanticProps }
		if (option.href !== undefined && option.disabled !== true)
			return (
				<a key={option.value} {...commonProps} href={option.href}>
					{option.label}
				</a>
			)
		return (
			<button key={option.value} {...commonProps} type='button' disabled={option.disabled}>
				{option.label}
			</button>
		)
	}
	const renderOptions = () => {
		if (groupedOptions === undefined) return renderedOptions.map(({ index, option }) => renderOption(option, index))
		return groupedOptions.map(group => (
			<div key={group.ariaLabel} className={group.className} role='group' aria-label={group.ariaLabel}>
				{group.options.map(({ index, option }) => renderOption(option, index))}
			</div>
		))
	}
	const containerRole = ((): 'group' | 'tablist' | undefined => {
		if (resolvedSemantics === 'navigation') return undefined
		if (resolvedSemantics === 'tabs') return 'tablist'
		return 'group'
	})()
	useEffect(() => {
		const container = containerRef.current
		if (container === null || orientation !== 'horizontal') return
		const scrollBehavior = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
		const updateOverflowEdges = () => {
			const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth)
			setOverflowEdges({
				end: container.scrollLeft < maxScrollLeft - 1,
				start: container.scrollLeft > 1,
			})
		}
		const scrollActiveOptionIntoView = () => {
			const activeOption = container.querySelector('.view-tab.active')
			if (container.scrollWidth <= container.clientWidth || !(activeOption instanceof HTMLElement)) return
			const containerRect = container.getBoundingClientRect()
			const activeOptionRect = activeOption.getBoundingClientRect()
			const centeredScrollLeft = container.scrollLeft + activeOptionRect.left - containerRect.left - (container.clientWidth - activeOptionRect.width) / 2
			const targetScrollLeft = Math.min(container.scrollWidth - container.clientWidth, Math.max(0, centeredScrollLeft))
			if (typeof container.scrollTo === 'function') container.scrollTo({ behavior: scrollBehavior, left: targetScrollLeft })
			else container.scrollLeft = targetScrollLeft
		}
		updateOverflowEdges()
		scrollActiveOptionIntoView()
		container.addEventListener('scroll', updateOverflowEdges, { passive: true })
		const resizeObserver =
			typeof ResizeObserver === 'undefined'
				? undefined
				: new ResizeObserver(() => {
						updateOverflowEdges()
						scrollActiveOptionIntoView()
					})
		resizeObserver?.observe(container)
		return () => {
			container.removeEventListener('scroll', updateOverflowEdges)
			resizeObserver?.disconnect()
		}
	}, [options.length, orientation, value])
	return (
		<div ref={containerRef} className={`view-tabs ${variant} ${overflowEdges.start ? 'has-overflow-start' : ''} ${overflowEdges.end ? 'has-overflow-end' : ''} ${className}`.trim()} data-orientation={orientation} data-size={size} role={containerRole} aria-label={containerRole === undefined ? undefined : ariaLabel}>
			{renderOptions()}
		</div>
	)
}
