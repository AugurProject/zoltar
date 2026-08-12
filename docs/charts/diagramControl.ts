type DiagramAction = {
	removeAttribute: (name: string) => void
	setAttribute: (name: string, value: string) => void
	textContent: string | null
}

type DiagramCue = {
	textContent: string | null
}

export type DiagramBackgroundState = {
	element: HTMLElement
	inert: boolean
}

export type DiagramAttributeState = {
	ariaModal: string | undefined
	role: string | undefined
}

export function resolveChartEnvelopeWidth(envelopeWidth: number, parentWidth: number, viewportWidth: number): number {
	if (envelopeWidth > 0) return envelopeWidth
	if (parentWidth > 0) return parentWidth
	return Math.max(0, viewportWidth - 32)
}

export function hasDiagramOverflow(clientWidth: number, scrollWidth: number): boolean {
	return scrollWidth > clientWidth + 1
}

export function diagramBackgroundElements(dialog: Element): HTMLElement[] {
	const background: HTMLElement[] = []
	const document = dialog.ownerDocument
	const ElementConstructor = document.defaultView?.HTMLElement
	let current: Element = dialog
	while (current !== document.body) {
		const parent = current.parentElement
		if (parent === null) break
		for (const sibling of Array.from(parent.children)) {
			if (ElementConstructor !== undefined && sibling instanceof ElementConstructor && sibling !== current) background.push(sibling as HTMLElement)
		}
		current = parent
	}
	return background
}

export function enforceDiagramBackground(background: DiagramBackgroundState[]): void {
	for (const state of background) state.element.inert = true
}

export function isolateDiagramBackground(dialog: Element): DiagramBackgroundState[] {
	const background = diagramBackgroundElements(dialog).map(element => ({ element, inert: element.inert }))
	enforceDiagramBackground(background)
	return background
}

export function restoreDiagramBackground(background: DiagramBackgroundState[]): void {
	for (const state of background) state.element.inert = state.inert
}

export function expandDiagramAttributes(diagram: Element): DiagramAttributeState {
	const attributes = {
		ariaModal: diagram.getAttribute('aria-modal') ?? undefined,
		role: diagram.getAttribute('role') ?? undefined,
	}
	diagram.setAttribute('role', 'dialog')
	diagram.setAttribute('aria-modal', 'true')
	return attributes
}

export function restoreDiagramAttributes(diagram: Element, attributes: DiagramAttributeState): void {
	if (attributes.role === undefined) diagram.removeAttribute('role')
	else diagram.setAttribute('role', attributes.role)
	if (attributes.ariaModal === undefined) diagram.removeAttribute('aria-modal')
	else diagram.setAttribute('aria-modal', attributes.ariaModal)
}

export function updateDiagramControl(button: DiagramAction, cue: DiagramCue, isExpanded: boolean): void {
	button.textContent = isExpanded ? 'Close full screen' : 'View full screen'
	button.removeAttribute('aria-pressed')
	button.setAttribute('aria-expanded', String(isExpanded))
	cue.textContent = isExpanded ? 'Scroll to inspect detailed labels. Press Escape to close.' : 'Use full screen to inspect detailed labels.'
}
