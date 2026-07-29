type DiagramAction = {
	removeAttribute: (name: string) => void
	textContent: string | null
}

type DiagramCue = {
	textContent: string | null
}

export function resolveChartEnvelopeWidth(envelopeWidth: number, parentWidth: number, viewportWidth: number): number {
	if (envelopeWidth > 0) return envelopeWidth
	if (parentWidth > 0) return parentWidth
	return Math.max(0, viewportWidth - 32)
}

export function hasDiagramOverflow(clientWidth: number, scrollWidth: number): boolean {
	return scrollWidth > clientWidth + 1
}

export function updateDiagramControl(button: DiagramAction, cue: DiagramCue, isFit: boolean): void {
	button.textContent = isFit ? 'View full size' : 'Fit to width'
	button.removeAttribute('aria-pressed')
	cue.textContent = isFit ? 'Full size reveals detailed labels.' : 'Scroll horizontally to inspect labels.'
}
