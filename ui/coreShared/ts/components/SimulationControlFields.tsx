type SimulationControlFieldProps = {
	disabled: boolean
	kind: 'decimal' | 'milliseconds'
	label: string
	onCommit: (input: string) => void
	value: string
	onInput: (value: string) => void
}

export function SimulationControlField({ disabled, kind, label, onCommit, onInput, value }: SimulationControlFieldProps) {
	const milliseconds = kind === 'milliseconds'
	return (
		<label className='simulation-delay-field'>
			<span className='simulation-delay-label'>{label}</span>
			<input
				className='simulation-control-input'
				type={milliseconds ? 'number' : 'text'}
				min={milliseconds ? '0' : undefined}
				step={milliseconds ? '100' : undefined}
				inputMode={milliseconds ? 'numeric' : 'decimal'}
				value={value}
				disabled={disabled}
				onInput={event => {
					onInput(event.currentTarget.value)
				}}
				onChange={event => {
					onCommit(event.currentTarget.value)
				}}
			/>
		</label>
	)
}

type SimulationNameFieldProps = {
	disabled: boolean
	id: string
	label: string
	value: string
	onInput: (value: string) => void
}

export function SimulationNameField({ disabled, id, label, onInput, value }: SimulationNameFieldProps) {
	return (
		<div className='field'>
			<label htmlFor={id}>{label}</label>
			<input id={id} className='simulation-control-input' type='text' value={value} disabled={disabled} onInput={event => onInput(event.currentTarget.value)} />
		</div>
	)
}

/** Keep mutable input state in the owner while fields receive a value and callback. */
export function createSimulationInputHandler(input: { value: string }) {
	return (value: string) => {
		input.value = value
	}
}
