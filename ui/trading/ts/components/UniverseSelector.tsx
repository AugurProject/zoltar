import * as copy from '../copy/app.js'
import type { UniverseOption } from '../lib/universeOptions.js'

export function UniverseSelector({ options, selectedId, disabled, onChange }: { options: readonly UniverseOption[]; selectedId: string | undefined; disabled: boolean; onChange(selectedId: string): void }) {
	const selected = options.find(option => option.id === selectedId)
	return (
		<label class='universe-selector'>
			<select aria-label={copy.selectUniverse} title={selected?.accessibleLabel ?? selected?.label} value={selectedId ?? ''} disabled={disabled || options.length === 0} onChange={event => onChange(event.currentTarget.value)}>
				{options.length === 0 ? (
					<option value=''>{copy.unavailable}</option>
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
