import { useEffect, useId, useState } from 'preact/hooks'
import * as universeCopy from '../copy/universes.js'
import { tryParseBigIntInput } from '../forms/integerInput.js'
import { navigateToUniverse } from '../navigation/universeNavigation.js'
import { FormInput } from './FormInput.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { SectionBlock } from './SectionBlock.js'

/** Direct lookup keeps navigation independent of the size of the universe tree. */
export function UniverseLookup({ activeUniverseId, collapsible = false }: { activeUniverseId: bigint; collapsible?: boolean }) {
	const inputId = useId()
	const [input, setInput] = useState('')
	const [submitted, setSubmitted] = useState(false)
	useEffect(() => {
		setInput('')
		setSubmitted(false)
	}, [activeUniverseId])
	const parsed = tryParseBigIntInput(input)
	const universeId = parsed !== undefined && parsed >= 0n && parsed < 2n ** 248n ? parsed : undefined
	const error = submitted && universeId === undefined ? universeCopy.universeIdInvalid : undefined
	const form = (
		<form
			className='form-grid'
			onSubmit={event => {
				event.preventDefault()
				setSubmitted(true)
				if (universeId !== undefined) navigateToUniverse(universeId)
			}}
		>
			<div className='field'>
				<label htmlFor={inputId}>{collapsible ? universeCopy.universeId : universeCopy.openUniverseById}</label>
				<FormInput
					id={inputId}
					value={input}
					onInput={event => setInput(event.currentTarget.value)}
					error={error}
					liveError
					action={
						<button className='secondary' type='submit'>
							{universeCopy.openUniverse}
						</button>
					}
				/>
			</div>
		</form>
	)
	return <SectionBlock variant='plain'>{collapsible ? <ReadOnlyDetailAccordion title={universeCopy.openUniverseById}>{form}</ReadOnlyDetailAccordion> : form}</SectionBlock>
}
