const planner = document.querySelector('#mmr-proof-planner')
if (!(planner instanceof HTMLDetailsElement)) {
	throw new Error('MMR proof planner is missing')
}

const leafCountInput = planner.querySelector('[data-tool-input="leafCount"]')
const peakHeightSelect = planner.querySelector('[data-tool-input="peakHeight"]')
const leafIndexInput = planner.querySelector('[data-tool-input="leafIndex"]')
if (!(leafCountInput instanceof HTMLInputElement) || !(peakHeightSelect instanceof HTMLSelectElement) || !(leafIndexInput instanceof HTMLInputElement)) {
	throw new Error('MMR proof planner controls are incomplete')
}

function writeOutput(name, value) {
	const output = planner.querySelector(`[data-mmr-output="${name}"]`)
	if (output instanceof HTMLOutputElement) output.value = value
}

function unsignedInteger(value) {
	const source = value.trim()
	if (!/^[0-9]+$/.test(source)) return undefined
	return BigInt(source)
}

function occupiedPeakHeights(leafCount) {
	const heights = []
	let remaining = leafCount
	let height = 0
	while (remaining > 0n) {
		if ((remaining & 1n) === 1n) heights.push(height)
		remaining >>= 1n
		height += 1
	}
	return heights
}

function updatePeakOptions(peaks) {
	const current = Number(peakHeightSelect.value)
	peakHeightSelect.disabled = false
	peakHeightSelect.replaceChildren(
		...peaks.map(height => {
			const option = document.createElement('option')
			option.value = String(height)
			option.textContent = `Height ${height}`
			return option
		}),
	)
	peakHeightSelect.value = String(peaks.includes(current) ? current : peaks.at(-1))
}

function clearPeakOptions() {
	const option = document.createElement('option')
	option.value = ''
	option.textContent = 'Enter a valid leaf count'
	peakHeightSelect.replaceChildren(option)
	peakHeightSelect.disabled = true
}

function updatePlanner() {
	const leafCount = unsignedInteger(leafCountInput.value)
	if (leafCount === undefined || leafCount < 1n || leafCount >= 1n << 64n) {
		leafCountInput.setAttribute('aria-invalid', 'true')
		clearPeakOptions()
		for (const name of ['binary', 'peaks', 'capacity', 'mmrSiblings', 'selection']) {
			writeOutput(name, 'Enter an integer from 1 through 2⁶⁴ − 1')
		}
		return
	}

	leafCountInput.removeAttribute('aria-invalid')
	const peaks = occupiedPeakHeights(leafCount)
	updatePeakOptions(peaks)
	const peakHeight = Number(peakHeightSelect.value)
	const capacity = 1n << BigInt(peakHeight)
	const leafIndex = unsignedInteger(leafIndexInput.value)
	const validIndex = leafIndex !== undefined && leafIndex < capacity

	writeOutput('binary', `${leafCount.toString(2)}₂`)
	writeOutput('peaks', peaks.join(', '))
	writeOutput('capacity', `${capacity.toLocaleString()} ${capacity === 1n ? 'leaf' : 'leaves'}; local indexes 0…${(capacity - 1n).toLocaleString()}`)
	writeOutput('mmrSiblings', String(peakHeight + peaks.length - 1))
	writeOutput('nullifierSiblings', '64')
	writeOutput('selection', validIndex ? 'Valid peak-local index' : `Index must be between 0 and ${capacity - 1n}`)
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
