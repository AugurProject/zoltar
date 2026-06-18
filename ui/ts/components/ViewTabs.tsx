import type { ViewTabOption, ViewTabsProps } from '../types/components.js'

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
	return groups.map(group => {
		const groupedOptions = group.values.flatMap(groupValue => {
			const option = optionsByValue.get(groupValue)
			return option === undefined ? [] : [option]
		})
		if (group.className === undefined) return { ariaLabel: group.ariaLabel, options: groupedOptions }
		return { ariaLabel: group.ariaLabel, className: group.className, options: groupedOptions }
	})
}

export function ViewTabs<TValue extends string>({ ariaLabel, className = '', groups, onChange, options, orientation = 'horizontal', size = 'default', value, variant = 'subroute' }: ViewTabsProps<TValue>) {
	const indexedOptions = options.map((option, index) => ({ index, option }))
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
		const commonProps = {
			className: `view-tab ${active ? 'active' : ''}`.trim(),
			id: tabId,
			role: 'tab',
			'aria-controls': option.panelId,
			'aria-selected': active,
			tabIndex: active ? 0 : -1,
			title: option.reason,
			onClick: () => {
				if (option.disabled) return
				onChange(option.value)
			},
			onKeyDown: (event: KeyboardEvent) => handleKeyDown(index, event),
		} as const
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
	return (
		<div className={`view-tabs ${variant} ${className}`.trim()} data-orientation={orientation} data-size={size} role='tablist' aria-label={ariaLabel}>
			{renderOptions()}
		</div>
	)
}
