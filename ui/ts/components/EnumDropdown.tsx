import { useEffect, useRef, useState } from 'preact/hooks'

export type EnumDropdownOption<T extends string> = {
	label: string
	value: T
}

type EnumDropdownProps<T extends string> = {
	disabled?: boolean
	onChange: (value: T) => void
	options: ReadonlyArray<EnumDropdownOption<T>>
	value: T
}

export function EnumDropdown<T extends string>({ disabled = false, onChange, options, value }: EnumDropdownProps<T>) {
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement | null>(null)
	const selectedOption = options.find(option => option.value === value) ?? options[0]

	useEffect(() => {
		const handleDocumentMouseDown = (event: MouseEvent) => {
			if (rootRef.current === null) return
			if (event.target instanceof Node && rootRef.current.contains(event.target)) return
			setOpen(false)
		}

		const handleDocumentKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setOpen(false)
			}
		}

		document.addEventListener('mousedown', handleDocumentMouseDown)
		document.addEventListener('keydown', handleDocumentKeyDown)
		return () => {
			document.removeEventListener('mousedown', handleDocumentMouseDown)
			document.removeEventListener('keydown', handleDocumentKeyDown)
		}
	}, [])

	return (
		<div className="enum-dropdown" ref={rootRef}>
			<button
				className={`enum-dropdown-trigger ${open ? 'open' : ''}`}
				type="button"
				disabled={disabled}
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => {
					if (disabled) return
					setOpen(current => !current)
				}}
			>
				<span className="enum-dropdown-label">{selectedOption?.label ?? value}</span>
				<span className="enum-dropdown-chevron" aria-hidden="true" />
			</button>
			{open ? (
				<div className="enum-dropdown-menu" role="listbox" aria-label="Dropdown options">
					{options.map(option => (
						<button
							key={option.value}
							className={`enum-dropdown-option ${option.value === value ? 'selected' : ''}`}
							type="button"
							role="option"
							aria-selected={option.value === value}
							onClick={() => {
								onChange(option.value)
								setOpen(false)
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
