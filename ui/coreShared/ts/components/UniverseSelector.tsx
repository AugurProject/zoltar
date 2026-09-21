import * as commonCopy from '../copy/common.js'

export type UniverseOption = Readonly<{ id: string; label: string; accessibleLabel?: string }>

type UniverseSelectorProps = {
	disabled: boolean
	loading: boolean
	onChange: (selectedId: string) => void
	options: readonly UniverseOption[]
	selectedId: string | undefined
}

/** Toolbar universe switcher for applications that can address more than one universe at a time. */
export function UniverseSelector({ options, selectedId, disabled, loading, onChange }: UniverseSelectorProps) {
	const selected = options.find(option => option.id === selectedId)
	return (
		<label className='universe-selector'>
			<select aria-label={commonCopy.selectUniverse} title={selected?.accessibleLabel ?? selected?.label} value={selectedId ?? ''} disabled={disabled || options.length === 0} onChange={event => onChange(event.currentTarget.value)}>
				{options.length === 0 ? (
					<option value=''>{loading ? commonCopy.loadingWithEllipsis : commonCopy.unavailable}</option>
				) : (
					options.map(option => (
						<option key={option.id} value={option.id} aria-label={option.accessibleLabel ?? option.label} title={option.accessibleLabel ?? option.label}>
							{option.label}
						</option>
					))
				)}
			</select>
		</label>
	)
}
