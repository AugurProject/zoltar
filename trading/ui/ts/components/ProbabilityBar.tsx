export function roundedProbabilityLabels(yesPercent: number) {
	const roundedYes = Math.round((yesPercent + Number.EPSILON * Math.abs(yesPercent)) * 10) / 10
	return { yes: roundedYes.toFixed(1), no: (100 - roundedYes).toFixed(1) }
}

export function ProbabilityBar({ yesPercent, beforePercent }: { yesPercent: number; beforePercent?: number }) {
	const labels = roundedProbabilityLabels(yesPercent)
	return (
		<figure class='probability' aria-label={`Conditional YES price ${labels.yes} percent`}>
			<div class='probability__labels'>
				<span>YES {labels.yes}%</span>
				<span>NO {labels.no}%</span>
			</div>
			<div class='probability__track'>
				<div class='probability__yes' style={{ width: `${yesPercent}%` }} />
				{beforePercent === undefined ? null : <span class='probability__marker' style={{ left: `${beforePercent}%` }} aria-label={`Before ${beforePercent.toFixed(1)} percent`} />}
			</div>
			<figcaption>YES share of valid outcomes</figcaption>
		</figure>
	)
}
