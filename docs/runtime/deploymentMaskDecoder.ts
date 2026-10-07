import { requiredElementFinder } from './domHelpers'

type DeploymentStep = {
	id: string
	label: string
}

const requiredElement = requiredElementFinder('deployment decoder')

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateManifest(manifest: unknown): DeploymentStep[] {
	if (!isRecord(manifest) || !Array.isArray(manifest['deploymentSteps'])) throw new TypeError('Deployment manifest has no deploymentSteps array')
	const steps: DeploymentStep[] = []
	for (const candidate of manifest['deploymentSteps']) {
		if (!isRecord(candidate) || typeof candidate['id'] !== 'string' || candidate['id'].length === 0 || typeof candidate['label'] !== 'string' || candidate['label'].length === 0) {
			throw new TypeError('Deployment manifest step has an invalid id or label')
		}
		steps.push({ id: candidate['id'], label: candidate['label'] })
	}
	const stepIds = steps.map(step => step.id)
	if (new Set(stepIds).size !== stepIds.length) throw new TypeError('Deployment manifest has duplicate step ids')
	if (stepIds.filter(id => id === 'deploymentStatusOracle').length !== 1) throw new TypeError('Deployment manifest must contain exactly one deploymentStatusOracle step')
	const tracked = steps.filter(step => step.id !== 'deploymentStatusOracle')
	if (tracked.length === 0 || tracked.length > 256) throw new TypeError('Deployment manifest must contain between 1 and 256 tracked steps')
	return tracked
}

type NetworkId = 'mainnet' | 'sepolia'

type NetworkMapping = {
	body: HTMLTableSectionElement
	label: string
	manifestUrl: string
	steps: DeploymentStep[] | undefined
}

const decoder = requiredElement(document, '#deployment-mask-decoder', HTMLDetailsElement)
const networkSelect = requiredElement(decoder, '[data-deployment-mask-network]', HTMLSelectElement)
const maskInput = requiredElement(decoder, '[data-tool-input="deploymentMask"]', HTMLInputElement)
const maskSummary = requiredElement(decoder, '[data-deployment-mask-summary]', HTMLOutputElement)
const maskGuidance = requiredElement(decoder, '[data-deployment-mask-guidance]', HTMLElement)
const retryButton = requiredElement(decoder, '[data-deployment-mask-retry]', HTMLButtonElement)
const bitGrid = requiredElement(decoder, '[data-deployment-bit-grid]', HTMLElement)
const networks: Record<NetworkId, NetworkMapping> = {
	mainnet: { body: requiredElement(document, '#deployment-status-bit-mapping', HTMLTableSectionElement), label: 'Ethereum mainnet', manifestUrl: '../mainnet-deployment-addresses.json', steps: undefined },
	sepolia: { body: requiredElement(document, '#sepolia-deployment-status-bit-mapping', HTMLTableSectionElement), label: 'Sepolia', manifestUrl: '../sepolia-deployment-addresses.json', steps: undefined },
}
const networkIds = ['mainnet', 'sepolia'] as const
let loading = false

function selectedNetworkId(): NetworkId {
	return networkSelect.value === 'sepolia' ? 'sepolia' : 'mainnet'
}

function setToolUnavailable(unavailable: boolean): void {
	if (unavailable) decoder.dataset['toolUnavailable'] = 'true'
	else delete decoder.dataset['toolUnavailable']
	maskInput.disabled = unavailable
	for (const button of bitGrid.querySelectorAll('button')) button.disabled = unavailable
	decoder.dispatchEvent(new CustomEvent('docs:tool-availability'))
}

function renderMessageRow(body: HTMLTableSectionElement, message: string, linkUrl?: string): void {
	const row = document.createElement('tr')
	const cell = document.createElement('td')
	cell.colSpan = 4
	cell.append(message)
	if (linkUrl !== undefined) {
		cell.append(document.createElement('br'))
		const link = document.createElement('a')
		link.href = linkUrl
		link.textContent = 'Open the canonical manifest.'
		cell.append(link)
	}
	row.append(cell)
	body.replaceChildren(row)
}

function createStepRow(step: DeploymentStep, bit: number): HTMLTableRowElement {
	const row = document.createElement('tr')
	row.dataset['deploymentBit'] = String(bit)
	for (const [value, useCode] of [
		[String(bit), true],
		[step.id, true],
		[step.label, false],
	] as const) {
		const cell = document.createElement('td')
		if (useCode) {
			const code = document.createElement('code')
			code.textContent = value
			cell.append(code)
		} else cell.textContent = value
		row.append(cell)
	}
	const statusCell = document.createElement('td')
	statusCell.dataset['deploymentBitStatus'] = String(bit)
	row.append(statusCell)
	return row
}

function statusCells(body: HTMLTableSectionElement): HTMLTableCellElement[] {
	return Array.from(body.querySelectorAll('[data-deployment-bit-status]')).filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement)
}

function markOtherNetworksNotDecoded(): void {
	for (const networkId of networkIds) {
		if (networkId === selectedNetworkId()) continue
		for (const statusCell of statusCells(networks[networkId].body)) {
			statusCell.textContent = 'Not decoded · other network selected'
			delete statusCell.dataset['maskState']
		}
	}
}

function renderBitGrid(steps: readonly DeploymentStep[]): void {
	const buttons = steps.map((step, bit) => {
		const button = document.createElement('button')
		button.type = 'button'
		button.dataset['deploymentBitToggle'] = String(bit)
		button.textContent = String(bit)
		button.title = `${bit}: ${step.label}`
		button.setAttribute('aria-label', `Toggle bit ${bit}, ${step.label}`)
		button.setAttribute('aria-pressed', 'false')
		button.addEventListener('click', () => {
			const parsed = parseMask(maskInput.value)
			if (parsed === undefined) return
			maskInput.value = `0x${(parsed ^ (1n << BigInt(bit))).toString(16)}`
			updateDecoder()
			decoder.dispatchEvent(new CustomEvent('docs:tool-input-change'))
		})
		return button
	})
	bitGrid.replaceChildren(...buttons)
}

async function loadNetwork(networkId: NetworkId): Promise<void> {
	const network = networks[networkId]
	network.body.setAttribute('aria-busy', 'true')
	renderMessageRow(network.body, 'Loading the canonical manifest…')
	try {
		const response = await fetch(network.manifestUrl)
		if (!response.ok) throw new TypeError(`Could not load deployment manifest: ${response.status}`)
		network.steps = validateManifest(await response.json())
		network.body.replaceChildren(...network.steps.map((step, bit) => createStepRow(step, bit)))
	} catch (error) {
		if (!(error instanceof TypeError) && !(error instanceof SyntaxError)) throw error
		network.steps = undefined
		renderMessageRow(network.body, 'Unable to load the deployment mapping. ', network.manifestUrl)
	} finally {
		network.body.setAttribute('aria-busy', 'false')
	}
}

function parseMask(source: string): bigint | undefined {
	const normalized = source.trim()
	if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(normalized)) return undefined
	const mask = BigInt(normalized)
	return mask < 1n << 256n ? mask : undefined
}

// Bit toggles cannot act on an invalid mask, so they are disabled until the value parses again.
function markStatusesUnavailable(body: HTMLTableSectionElement): void {
	for (const statusCell of statusCells(body)) {
		statusCell.textContent = 'Unavailable · invalid mask'
		delete statusCell.dataset['maskState']
	}
	for (const button of bitGrid.querySelectorAll('button')) {
		button.removeAttribute('data-mask-state')
		// No bit is set while the mask does not parse; updateDecoder restores the pressed state once it does.
		button.setAttribute('aria-pressed', 'false')
		button.disabled = true
	}
}

function updateDecoder(): void {
	const network = networks[selectedNetworkId()]
	const steps = network.steps
	if (steps === undefined || maskInput.disabled) return
	markOtherNetworksNotDecoded()
	const source = maskInput.value.trim()
	const mask = parseMask(source)
	if (mask === undefined) {
		maskInput.setAttribute('aria-invalid', 'true')
		markStatusesUnavailable(network.body)
		const numeric = /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(source)
		maskSummary.value = numeric ? 'The value is larger than a uint256.' : 'Enter a non-negative decimal or hexadecimal integer.'
		maskGuidance.textContent = numeric ? 'Use a value between 0 and 2²⁵⁶ − 1.' : 'Examples: 5, 0x5, or 0xff.'
		decoder.dataset['widgetState'] = 'unsafe'
		return
	}
	maskInput.removeAttribute('aria-invalid')
	const deployedSteps: string[] = []
	for (const [bit, step] of steps.entries()) {
		const isSet = (mask & (1n << BigInt(bit))) !== 0n
		const statusCell = network.body.querySelector(`[data-deployment-bit-status="${bit}"]`)
		if (statusCell instanceof HTMLTableCellElement) {
			statusCell.textContent = isSet ? 'Set · code present' : 'Clear · no code'
			statusCell.dataset['maskState'] = isSet ? 'set' : 'clear'
		}
		const button = bitGrid.querySelector<HTMLButtonElement>(`[data-deployment-bit-toggle="${bit}"]`)
		if (button !== null) {
			button.disabled = false
			button.setAttribute('aria-pressed', String(isSet))
			button.dataset['maskState'] = isSet ? 'set' : 'clear'
		}
		if (isSet) deployedSteps.push(step.label)
	}
	const unknownBits = mask >> BigInt(steps.length)
	const scope = `${network.label}: `
	maskSummary.value = deployedSteps.length === 0 ? `${scope}0 of ${steps.length} tracked steps have set bits.` : `${scope}${deployedSteps.length} of ${steps.length} tracked steps have set bits: ${deployedSteps.join(', ')}.`
	maskGuidance.textContent = unknownBits === 0n ? 'No bits are set above the tracked manifest range.' : `Additional untracked high bits are set (shifted value ${unknownBits.toString(16).toUpperCase()} hex). Verify the constructor event before interpreting them.`
	decoder.dataset['widgetState'] = unknownBits === 0n ? 'safe' : 'warning'
}

function applySelectedNetwork(): void {
	if (loading) return
	const network = networks[selectedNetworkId()]
	maskInput.removeAttribute('aria-invalid')
	if (network.steps === undefined) {
		bitGrid.replaceChildren()
		setToolUnavailable(true)
		retryButton.hidden = false
		retryButton.disabled = false
		maskSummary.value = `The ${network.label} mapping is unavailable, so this mask cannot be decoded safely.`
		maskGuidance.textContent = 'Retry to restore bit decoding and high-bit reporting.'
		decoder.dataset['widgetState'] = 'unsafe'
		return
	}
	renderBitGrid(network.steps)
	retryButton.hidden = networkIds.every(networkId => networks[networkId].steps !== undefined)
	retryButton.disabled = false
	setToolUnavailable(false)
	updateDecoder()
}

async function loadMappings(): Promise<void> {
	setToolUnavailable(true)
	retryButton.hidden = true
	retryButton.disabled = true
	maskInput.removeAttribute('aria-invalid')
	maskSummary.value = 'Loading the canonical mapping…'
	maskGuidance.textContent = 'Decoder controls will be available when the mapping loads.'
	loading = true
	try {
		await Promise.all(networkIds.map(networkId => loadNetwork(networkId)))
	} finally {
		loading = false
	}
	applySelectedNetwork()
}

networkSelect.addEventListener('change', applySelectedNetwork)
maskInput.addEventListener('input', updateDecoder)
retryButton.addEventListener('click', () => {
	if (!loading) void loadMappings()
})
const deploymentMaskDecoderReady = loadMappings()
void deploymentMaskDecoderReady
