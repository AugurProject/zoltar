export function ProbabilityBar({ yesPercent, beforePercent }: { yesPercent: number; beforePercent?: number }) {
	return (
		<figure class='probability' aria-label={`Conditional YES price ${yesPercent.toFixed(1)} percent`}>
			<div class='probability__labels'>
				<span>YES {yesPercent.toFixed(1)}%</span>
				<span>NO {(100 - yesPercent).toFixed(1)}%</span>
			</div>
			<div class='probability__track'>
				<div class='probability__yes' style={{ width: `${yesPercent}%` }} />
				{beforePercent === undefined ? null : <span class='probability__marker' style={{ left: `${beforePercent}%` }} aria-label={`Before ${beforePercent.toFixed(1)} percent`} />}
			</div>
			<figcaption>YES share of valid outcomes</figcaption>
		</figure>
	)
}
