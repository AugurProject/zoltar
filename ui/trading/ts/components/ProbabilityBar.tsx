import { probabilityCopy } from '../copy/probability.js'

function roundedProbabilityLabels(yesPercent: number) {
	const roundedYes = Math.round((yesPercent + Number.EPSILON * Math.abs(yesPercent)) * 10) / 10
	return { yes: roundedYes.toFixed(1), no: (100 - roundedYes).toFixed(1) }
}

/** The conditional YES / NO split; with `beforePercent` it previews a trade: the fill shows the price after it and the marker the price before. */
export function ProbabilityBar({ yesPercent, beforePercent }: { yesPercent: number; beforePercent?: number | undefined }) {
	const labels = roundedProbabilityLabels(yesPercent)
	const before = beforePercent === undefined ? undefined : roundedProbabilityLabels(beforePercent)
	const moved = before !== undefined && before.yes !== labels.yes
	return (
		<figure className={`probability${moved ? ' probability--preview' : ''}`} aria-label={moved ? probabilityCopy.conditionalYesMoveLabel(before.yes, labels.yes) : probabilityCopy.conditionalYesPriceLabel(labels.yes)}>
			<div className='probability__labels'>
				<span>{moved ? probabilityCopy.probabilityMoveLabel(probabilityCopy.yes, before.yes, labels.yes) : probabilityCopy.probabilityLabel(probabilityCopy.yes, labels.yes)}</span>
				<span>{moved ? probabilityCopy.probabilityMoveLabel(probabilityCopy.no, before.no, labels.no) : probabilityCopy.probabilityLabel(probabilityCopy.no, labels.no)}</span>
			</div>
			<div className='probability__track'>
				<div className='probability__yes' style={{ width: `${yesPercent}%` }} />
				{moved && beforePercent !== undefined ? <span className='probability__marker' style={{ left: `${beforePercent}%` }} title={probabilityCopy.beforePriceLabel(before.yes)} /> : null}
			</div>
		</figure>
	)
}
