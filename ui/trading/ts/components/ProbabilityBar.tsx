import { probabilityCopy } from '../copy/probability.js'

function roundedProbabilityLabels(yesPercent: number) {
	const roundedYes = Math.round((yesPercent + Number.EPSILON * Math.abs(yesPercent)) * 10) / 10
	return { yes: roundedYes.toFixed(1), no: (100 - roundedYes).toFixed(1) }
}

export function ProbabilityBar({ yesPercent, beforePercent }: { yesPercent: number; beforePercent?: number }) {
	const labels = roundedProbabilityLabels(yesPercent)
	return (
		<figure className='probability' aria-label={probabilityCopy.conditionalYesPriceLabel(labels.yes)}>
			<div className='probability__labels'>
				<span>{probabilityCopy.probabilityLabel(probabilityCopy.yes, labels.yes)}</span>
				<span>{probabilityCopy.probabilityLabel(probabilityCopy.no, labels.no)}</span>
			</div>
			<div className='probability__track'>
				<div className='probability__yes' style={{ width: `${yesPercent}%` }} />
				{beforePercent === undefined ? null : <span className='probability__marker' style={{ left: `${beforePercent}%` }} aria-label={probabilityCopy.beforePriceLabel(beforePercent.toFixed(1))} />}
			</div>
		</figure>
	)
}
