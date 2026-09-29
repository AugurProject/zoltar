import type { Signal } from '@preact/signals'

type SimulationControlFieldProps = {
	disabled: boolean
	kind: 'decimal' | 'milliseconds'
	label: string
	onCommit: (input: string) => void
	value: Signal<string>
}

export function SimulationControlField({ disabled, kind, label, onCommit, value }: SimulationControlFieldProps) {
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
				value={value.value}
				disabled={disabled}
				onInput={event => {
					value.value = event.currentTarget.value
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
	value: Signal<string>
}

export function SimulationNameField({ disabled, id, label, value }: SimulationNameFieldProps) {
	return (
		<div className='field'>
			<label htmlFor={id}>{label}</label>
			<input id={id} className='simulation-control-input' type='text' value={value.value} disabled={disabled} onInput={event => (value.value = event.currentTarget.value)} />
		</div>
	)
}
