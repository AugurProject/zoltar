import * as commonCopy from '../copy/common.js'
import * as marketCopy from '../copy/market.js'
import { useEffect, useState } from 'preact/hooks'
import { ScalarOutcomePicker } from './ScalarOutcomePicker.js'
import { clampScalarTickIndex, formatScalarOutcomeLabel } from '../lib/scalarOutcome.js'

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
			label={marketCopy.scalarPreview}
			onInvalidChange={setIsInvalid}
			onSelectedTickChange={onSelectedTickChange}
			selectedOutcomeLabel={isInvalid ? commonCopy.invalid : formatScalarOutcomeLabel(details, clampedSelectedTickValue)}
			selectedTick={clampedSelectedTick}
			selectedTickLabel={isInvalid ? commonCopy.invalid : commonCopy.formatPairSlash(clampedSelectedTick, details.numTicks.toString())}
			showMinMax={false}
		/>
	)
}
