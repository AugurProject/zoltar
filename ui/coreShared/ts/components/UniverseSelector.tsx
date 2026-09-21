import * as commonCopy from '../copy/common.js'

export type UniverseOption = Readonly<{ id: string; label: string; accessibleLabel?: string }>

type UniverseSelectorProps = {
	disabled: boolean
	onChange: (selectedId: string) => void
	/** The universes to choose between; the application renders a static value while there is no real choice. */
	options: readonly UniverseOption[]
	selectedId: string | undefined
}

/** Toolbar universe switcher for applications that can address more than one universe at a time. */
export function UniverseSelector({ options, selectedId, disabled, onChange }: UniverseSelectorProps) {
	const selected = options.find(option => option.id === selectedId)
	return (
		<label className='universe-selector'>
			<select aria-label={commonCopy.selectUniverse} title={selected?.accessibleLabel ?? selected?.label} value={selectedId ?? ''} disabled={disabled} onChange={event => onChange(event.currentTarget.value)}>
				{options.map(option => (
					<option key={option.id} value={option.id} aria-label={option.accessibleLabel ?? option.label} title={option.accessibleLabel ?? option.label}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	)
}
