import { useEffect, useState } from 'preact/hooks'
import { ScalarOutcomePicker } from './ScalarOutcomePicker.js'
import { clampScalarTickIndex, formatScalarOutcomeLabel } from '../lib/scalarOutcome.js'
import { UI_STRING_INVALID, UI_STRING_SCALAR_PREVIEW, UI_TEMPLATE_PAIR_SLASH } from '../lib/uiStrings.js'

export type ScalarCreatePreviewDetails = {
	answerUnit: string
	displayValueMax: bigint
	displayValueMin: bigint
	numTicks: bigint
}

type ScalarCreatePreviewProps = {
	details: ScalarCreatePreviewDetails
	selectedTick: string
	onSelectedTickChange: (tick: string) => void
}

export function ScalarCreatePreview({ details, selectedTick, onSelectedTickChange }: ScalarCreatePreviewProps) {
	const [isInvalid, setIsInvalid] = useState(false)
	const selectedTickValue = BigInt(selectedTick)
	const clampedSelectedTickValue = clampScalarTickIndex(selectedTickValue, details.numTicks)
	const clampedSelectedTick = clampedSelectedTickValue.toString()
	useEffect(() => {
		if (clampedSelectedTick === selectedTick) return
		onSelectedTickChange(clampedSelectedTick)
	}, [clampedSelectedTick, onSelectedTickChange, selectedTick])

	return (
		<ScalarOutcomePicker
			details={{ numTicks: details.numTicks }}
			isInvalid={isInvalid}
			label={UI_STRING_SCALAR_PREVIEW}
			onInvalidChange={setIsInvalid}
			onSelectedTickChange={onSelectedTickChange}
			selectedOutcomeLabel={isInvalid ? UI_STRING_INVALID : formatScalarOutcomeLabel(details, clampedSelectedTickValue)}
			selectedTick={clampedSelectedTick}
			selectedTickLabel={isInvalid ? UI_STRING_INVALID : UI_TEMPLATE_PAIR_SLASH(clampedSelectedTick, details.numTicks.toString())}
			showMinMax={false}
		/>
	)
}
