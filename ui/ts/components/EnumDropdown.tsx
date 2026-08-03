import * as commonCopy from '../copy/common.js'
import { useEffect, useRef, useState } from 'preact/hooks'

export type EnumDropdownOption<T extends string> = {
	label: string
	value: T
}

type EnumDropdownProps<T extends string> = {
	ariaDescribedBy?: string | undefined
	ariaLabel?: string
	disabled?: boolean
	invalid?: boolean
	onChange: (value: T) => void
	options: ReadonlyArray<EnumDropdownOption<T>>
	placeholder?: string
	value: T | undefined
}

export function EnumDropdown<T extends string>({ ariaDescribedBy, ariaLabel, disabled = false, invalid = false, onChange, options, placeholder, value }: EnumDropdownProps<T>) {
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement | null>(null)
	const triggerRef = useRef<HTMLButtonElement | null>(null)
	const selectedOption = value === undefined ? undefined : options.find(option => option.value === value)
	const triggerLabel = selectedOption?.label ?? value ?? placeholder ?? ''
	const accessibleTriggerLabel = ariaLabel === undefined || triggerLabel === '' ? ariaLabel : commonCopy.formatLabelValue(ariaLabel, triggerLabel)
	const closeAndFocusTrigger = () => {
		setOpen(false)
		triggerRef.current?.focus()
	}

	const focusMenuOptionAt = (currentTarget: HTMLButtonElement | null, direction: -1 | 1) => {
		if (rootRef.current === null || currentTarget === null) return
		const menuOptions = Array.from(rootRef.current.querySelectorAll<HTMLButtonElement>('.enum-dropdown-option'))
		if (menuOptions.length === 0) return
		const currentIndex = menuOptions.indexOf(currentTarget)
		if (currentIndex === -1) return
		const nextIndex = (currentIndex + direction + menuOptions.length) % menuOptions.length
		menuOptions[nextIndex]?.focus()
	}

	useEffect(() => {
		if (!open || rootRef.current === null) return
		const selectedMenuOption = rootRef.current.querySelector<HTMLButtonElement>('.enum-dropdown-option.selected')
		const firstMenuOption = rootRef.current.querySelector<HTMLButtonElement>('.enum-dropdown-option')
		;(selectedMenuOption ?? firstMenuOption)?.focus()
	}, [open])

	useEffect(() => {
		if (disabled) setOpen(false)
	}, [disabled])

	useEffect(() => {
		const handleDocumentMouseDown = (event: MouseEvent) => {
			if (rootRef.current === null) return
			if (event.target instanceof Node && rootRef.current.contains(event.target)) return
			setOpen(false)
		}
		const handleDocumentFocusIn = (event: FocusEvent) => {
			if (rootRef.current === null) return
			if (event.target instanceof Node && rootRef.current.contains(event.target)) return
			setOpen(false)
		}
		const handleDocumentFocusOut = (event: FocusEvent) => {
			if (rootRef.current === null) return
			if (!(event.target instanceof Node) || !rootRef.current.contains(event.target)) return
			if (event.relatedTarget instanceof Node && rootRef.current.contains(event.relatedTarget)) return
			setOpen(false)
		}

		const handleDocumentKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false)
		}

		document.addEventListener('mousedown', handleDocumentMouseDown)
		document.addEventListener('focusin', handleDocumentFocusIn)
		document.addEventListener('focusout', handleDocumentFocusOut)
		document.addEventListener('keydown', handleDocumentKeyDown)
		return () => {
			document.removeEventListener('mousedown', handleDocumentMouseDown)
			document.removeEventListener('focusin', handleDocumentFocusIn)
			document.removeEventListener('focusout', handleDocumentFocusOut)
			document.removeEventListener('keydown', handleDocumentKeyDown)
		}
	}, [])

	return (
		<div className='enum-dropdown' ref={rootRef}>
			<button
				ref={triggerRef}
				className={`enum-dropdown-trigger ${open ? 'open' : ''}`}
				type='button'
				disabled={disabled}
				aria-describedby={ariaDescribedBy}
				aria-invalid={invalid ? 'true' : undefined}
				aria-label={accessibleTriggerLabel}
				aria-haspopup='listbox'
				aria-expanded={open}
				onKeyDown={event => {
					if (event.key === 'Escape') {
						setOpen(false)
						return
					}
					if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === ' ' || event.key === 'Enter') {
						event.preventDefault()
						if (!disabled) {
							setOpen(true)
						}
					}
				}}
				onClick={() => {
					if (disabled) return
					setOpen(current => !current)
				}}
			>
				<span className='enum-dropdown-label'>{triggerLabel}</span>
				<span className='enum-dropdown-chevron' aria-hidden='true' />
			</button>
			{open && !disabled ? (
				<div className='enum-dropdown-menu' role='listbox' aria-label={commonCopy.dropdownOptions}>
					{options.map(option => (
						<button
							key={option.value}
							className={`enum-dropdown-option ${option.value === value ? 'selected' : ''}`}
							type='button'
							role='option'
							aria-selected={option.value === value}
							onKeyDown={event => {
								if (event.key === 'Tab') {
									setTimeout(() => setOpen(false), 0)
									return
								}
								if (event.key === 'Escape') {
									closeAndFocusTrigger()
									return
								}
								if (event.key === 'ArrowDown') {
									event.preventDefault()
									focusMenuOptionAt(event.currentTarget, 1)
								}
								if (event.key === 'ArrowUp') {
									event.preventDefault()
									focusMenuOptionAt(event.currentTarget, -1)
								}
							}}
							onClick={() => {
								if (disabled) return
								onChange(option.value)
								closeAndFocusTrigger()
							}}
						>
							{option.label}
						</button>
					))}
				</div>
			) : undefined}
		</div>
	)
}
