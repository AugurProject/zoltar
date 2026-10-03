import type { ComponentChildren } from 'preact'
import type { ScalarQuestionDetails } from '@zoltar/zoltar-shared/questions/scalarOutcome'
import { ScalarOutcomePicker } from '@zoltar/ui-core-shared/components/ScalarOutcomePicker.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { formatScalarOutcomeLabel, getScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import * as copy from '../../../copy/universeNavigation.js'

export function resolveScalarUniverseSelection(question: ScalarQuestionDetails, tickInput: string, invalid: boolean) {
	if (invalid) return { outcomeIndex: 0n, label: commonCopy.invalid }
	if (!/^\d+$/.test(tickInput)) return { outcomeIndex: undefined, label: commonCopy.none }
	const tick = BigInt(tickInput)
	if (tick > question.numTicks) return { outcomeIndex: undefined, label: commonCopy.none }
	return { outcomeIndex: getScalarOutcomeIndex(question, tick), label: formatScalarOutcomeLabel(question, tick) }
}

/** Controlled scalar selector shared by universe traversal and REP migration. */
export function UniverseScalarPicker({
	question,
	tickInput,
	invalid,
	onTickChange,
	onInvalidChange,
	disabled = false,
	action,
}: {
	question: ScalarQuestionDetails
	tickInput: string
	invalid: boolean
	onTickChange: (tick: string) => void
	onInvalidChange: (invalid: boolean) => void
	disabled?: boolean
	action?: ComponentChildren
}) {
	const { label } = resolveScalarUniverseSelection(question, tickInput, invalid)
	return (
		<ScalarOutcomePicker
			details={{ ...question, minValueLabel: formatScalarOutcomeLabel(question, 0n), maxValueLabel: formatScalarOutcomeLabel(question, question.numTicks) }}
			disabled={disabled}
			isInvalid={invalid}
			label={copy.selectScalarOutcome}
			onInvalidChange={onInvalidChange}
			onSelectedTickChange={onTickChange}
			selectedOutcomeLabel={label}
			selectedTick={tickInput}
			action={action}
		/>
	)
}
