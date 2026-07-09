import { useEffect, useState } from 'preact/hooks'
import { ScalarOutcomePicker } from './ScalarOutcomePicker.js'
import { clampScalarTickIndex, formatScalarOutcomeLabel } from '../lib/scalarOutcome.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

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
			label={TSX_STRINGS.componentsScalarCreatePreview.copy001}
			onInvalidChange={setIsInvalid}
			onSelectedTickChange={onSelectedTickChange}
			selectedOutcomeLabel={isInvalid ? TSX_STRINGS.componentsScalarCreatePreview.copy002 : formatScalarOutcomeLabel(details, clampedSelectedTickValue)}
			selectedTick={clampedSelectedTick}
			selectedTickLabel={isInvalid ? TSX_STRINGS.componentsScalarCreatePreview.copy003 : TSX_STRINGS.componentsScalarCreatePreview.copy004(clampedSelectedTick, details.numTicks.toString())}
			showMinMax={false}
		/>
	)
}
