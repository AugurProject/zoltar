const planner = document.querySelector('#mmr-proof-planner')
if (!(planner instanceof HTMLDetailsElement)) {
	throw new Error('MMR proof planner is missing')
}
const plannerElement: HTMLDetailsElement = planner

function requiredElement<T extends Element>(root: ParentNode, selector: string, expected: new () => T): T {
	const found = root.querySelector(selector)
	if (!(found instanceof expected)) throw new Error(`Required MMR planner element ${selector} is missing or has the wrong type`)
	return found
}

const leafCountInput = requiredElement(planner, '[data-tool-input="leafCount"]', HTMLInputElement)
const peakHeightSelect = requiredElement(planner, '[data-tool-input="peakHeight"]', HTMLSelectElement)
const leafIndexInput = requiredElement(planner, '[data-tool-input="leafIndex"]', HTMLInputElement)

function createInputError(input: HTMLInputElement, id: string): HTMLSpanElement {
	const error = document.createElement('span')
	error.className = 'number-control-error'
	error.id = id
	error.hidden = true
	input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), id].filter(Boolean).join(' '))
	input.insertAdjacentElement('afterend', error)
	return error
}

function updateInputError(input: HTMLInputElement, error: HTMLSpanElement, message?: string): void {
	if (message === undefined) {
		input.removeAttribute('aria-invalid')
		error.hidden = true
		error.textContent = ''
		return
	}
	input.setAttribute('aria-invalid', 'true')
	error.textContent = message
	error.hidden = false
}

const leafCountError = createInputError(leafCountInput, 'mmr-leaf-count-error')
const leafIndexError = createInputError(leafIndexInput, 'mmr-leaf-index-error')
const snapshotGroup = leafCountInput.closest('details.tool-control-group')
const peakChoices = document.createElement('span')
peakChoices.className = 'peak-choice-control'
peakChoices.setAttribute('role', 'group')
peakChoices.setAttribute('aria-label', 'Occupied peak height')
peakHeightSelect.classList.add('visually-hidden-control')
peakHeightSelect.tabIndex = -1
peakHeightSelect.setAttribute('aria-hidden', 'true')
peakHeightSelect.insertAdjacentElement('afterend', peakChoices)

function writeOutput(name: string, value: string): void {
	const output = plannerElement.querySelector(`[data-mmr-output="${name}"]`)
	if (output instanceof HTMLOutputElement) output.value = value
}

function setProofLengthMeter(name: string, value: number, maximum: number): void {
	const output = plannerElement.querySelector(`[data-mmr-output="${name}"]`)
	const card = output?.parentElement
	if (card === null || card === undefined) return
	card.dataset['widgetMeter'] = 'true'
	card.style.setProperty('--widget-meter', `${Math.min(100, Math.max(0, (value / maximum) * 100))}%`)
}

function clearProofLengthMeters(): void {
	for (const name of ['mmrSiblings', 'nullifierSiblings']) {
		const card = plannerElement.querySelector(`[data-mmr-output="${name}"]`)?.parentElement
		if (card === null || card === undefined) continue
		delete card.dataset['widgetMeter']
		card.style.removeProperty('--widget-meter')
	}
}

function unsignedInteger(value: string): bigint | undefined {
	const source = value.trim()
	if (!/^[0-9]+$/.test(source)) return undefined
	return BigInt(source)
}

function occupiedPeakHeights(leafCount: bigint): number[] {
	const heights: number[] = []
	let remaining = leafCount
	let height = 0
	while (remaining > 0n) {
		if ((remaining & 1n) === 1n) heights.push(height)
		remaining >>= 1n
		height += 1
	}
	return heights
}

function formatHeightRanges(heights: readonly number[]): string {
	const ranges: string[] = []
	const appendRange = (start: number, end: number): void => {
		if (end - start >= 3) ranges.push(`${start}–${end}`)
		else for (let height = start; height <= end; height += 1) ranges.push(String(height))
	}
	let start = heights[0]
	let end = start
	for (const height of heights.slice(1)) {
		if (end !== undefined && height === end + 1) {
			end = height
			continue
		}
		if (start !== undefined && end !== undefined) appendRange(start, end)
		start = height
		end = height
	}
	if (start !== undefined && end !== undefined) appendRange(start, end)
	return ranges.join(', ')
}

function setPlannerStatus(message?: string): void {
	const status = plannerElement.querySelector<HTMLElement>('.interactive-tool-status')
	if (status === null) return
	if (message !== undefined) {
		status.dataset['validationError'] = 'true'
		status.textContent = message
	} else if (status.dataset['validationError'] === 'true') {
		delete status.dataset['validationError']
		status.textContent = ''
	}
}

function updatePeakOptions(peaks: readonly number[]): void {
	const current = Number(peakHeightSelect.value)
	const selectedHeight = String(peaks.includes(current) ? current : peaks.at(-1))
	const useNativeSelect = peaks.length > 8
	peakHeightSelect.classList.toggle('visually-hidden-control', !useNativeSelect)
	peakHeightSelect.tabIndex = useNativeSelect ? 0 : -1
	peakHeightSelect.setAttribute('aria-hidden', String(!useNativeSelect))
	peakChoices.hidden = useNativeSelect
	const buttons = Array.from(peakChoices.querySelectorAll<HTMLButtonElement>('button'))
	const existingHeights = buttons.map(button => Number(button.dataset['peakHeight']))
	if (!useNativeSelect && existingHeights.length === peaks.length && existingHeights.every((height, index) => height === peaks[index])) {
		peakHeightSelect.disabled = false
		peakHeightSelect.value = selectedHeight
		for (const button of buttons) {
			button.disabled = false
			button.setAttribute('aria-pressed', String(button.dataset['peakHeight'] === selectedHeight))
		}
		return
	}
	peakHeightSelect.disabled = false
	peakHeightSelect.replaceChildren(
		...peaks.map(height => {
			const option = document.createElement('option')
			option.value = String(height)
			option.textContent = `Height ${height}`
			return option
		}),
	)
	peakHeightSelect.value = selectedHeight
	if (useNativeSelect) {
		peakChoices.replaceChildren()
		return
	}
	peakChoices.replaceChildren(
		...peaks.map(height => {
			const button = document.createElement('button')
			button.type = 'button'
			button.textContent = `Height ${height}`
			button.dataset['peakHeight'] = String(height)
			button.setAttribute('aria-pressed', String(peakHeightSelect.value === String(height)))
			button.addEventListener('click', () => {
				peakHeightSelect.value = String(height)
				peakHeightSelect.dispatchEvent(new Event('change', { bubbles: true }))
				plannerElement.dispatchEvent(new CustomEvent('docs:tool-input-change'))
			})
			return button
		}),
	)
}

function clearPeakOptions(): void {
	peakHeightSelect.disabled = true
	for (const button of peakChoices.querySelectorAll<HTMLButtonElement>('button')) button.disabled = true
}

function updatePlanner(): void {
	const leafCount = unsignedInteger(leafCountInput.value)
	if (leafCount === undefined || leafCount < 1n || leafCount >= 1n << 64n) {
		const message = 'Enter an integer from 1 through 2⁶⁴ − 1.'
		updateInputError(leafCountInput, leafCountError, message)
		updateInputError(leafIndexInput, leafIndexError)
		if (snapshotGroup instanceof HTMLDetailsElement) snapshotGroup.open = true
		setPlannerStatus(`Snapshot leaf count: ${message}`)
		clearPeakOptions()
		for (const name of ['binary', 'peaks', 'capacity', 'mmrSiblings', 'selection']) {
			writeOutput(name, '—')
		}
		clearProofLengthMeters()
		plannerElement.dataset['widgetState'] = 'unsafe'
		return
	}

	updateInputError(leafCountInput, leafCountError)
	setPlannerStatus()
	const peaks = occupiedPeakHeights(leafCount)
	updatePeakOptions(peaks)
	const peakHeight = Number(peakHeightSelect.value)
	const capacity = 1n << BigInt(peakHeight)
	const leafIndex = unsignedInteger(leafIndexInput.value)
	const validIndex = leafIndex !== undefined && leafIndex < capacity
	updateInputError(leafIndexInput, leafIndexError, validIndex ? undefined : `Enter an index from 0 through ${capacity - 1n}.`)
	for (const button of peakChoices.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset['peakHeight'] === peakHeightSelect.value))

	writeOutput('binary', `${leafCount.toString(2)}₂`)
	writeOutput('peaks', formatHeightRanges(peaks))
	writeOutput('capacity', `${capacity.toLocaleString()} ${capacity === 1n ? 'leaf' : 'leaves'}; local indexes 0…${(capacity - 1n).toLocaleString()}`)
	const mmrSiblings = peakHeight + peaks.length - 1
	const proofLengthMaximum = Math.max(mmrSiblings, 64)
	writeOutput('mmrSiblings', String(mmrSiblings))
	writeOutput('nullifierSiblings', '64')
	setProofLengthMeter('mmrSiblings', mmrSiblings, proofLengthMaximum)
	setProofLengthMeter('nullifierSiblings', 64, proofLengthMaximum)
	writeOutput('selection', validIndex ? 'Valid peak-local index' : `Index must be between 0 and ${capacity - 1n}`)
	plannerElement.dataset['widgetState'] = validIndex ? 'safe' : 'unsafe'
}

leafCountInput.addEventListener('input', () => {
	updatePlanner()
})
peakHeightSelect.addEventListener('change', updatePlanner)
leafIndexInput.addEventListener('input', updatePlanner)

const initialLeafCount = unsignedInteger(leafCountInput.value)
if (initialLeafCount === undefined) throw new Error('MMR proof planner default leaf count is invalid')
updatePeakOptions(occupiedPeakHeights(initialLeafCount))
peakHeightSelect.value = '2'
updatePlanner()
