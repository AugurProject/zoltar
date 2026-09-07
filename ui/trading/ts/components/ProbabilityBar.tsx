import * as probabilityCopy from '../copy/probability.js'

export function roundedProbabilityLabels(yesPercent: number) {
	const roundedYes = Math.round((yesPercent + Number.EPSILON * Math.abs(yesPercent)) * 10) / 10
	return { yes: roundedYes.toFixed(1), no: (100 - roundedYes).toFixed(1) }
}

export function ProbabilityBar({ yesPercent, beforePercent }: { yesPercent: number; beforePercent?: number }) {
	const labels = roundedProbabilityLabels(yesPercent)
	return (
		<figure class='probability' aria-label={probabilityCopy.conditionalYesPriceLabel(labels.yes)}>
			<div class='probability__labels'>
				<span>{probabilityCopy.probabilityLabel(probabilityCopy.yes, labels.yes)}</span>
				<span>{probabilityCopy.probabilityLabel(probabilityCopy.no, labels.no)}</span>
			</div>
			<div class='probability__track'>
				<div class='probability__yes' style={{ width: `${yesPercent}%` }} />
				{beforePercent === undefined ? null : <span class='probability__marker' style={{ left: `${beforePercent}%` }} aria-label={probabilityCopy.beforePriceLabel(beforePercent.toFixed(1))} />}
			</div>
			<figcaption>{probabilityCopy.currentSpotPriceCaption}</figcaption>
		</figure>
	)
}
