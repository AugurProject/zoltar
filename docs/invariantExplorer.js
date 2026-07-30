const explorer = document.querySelector('#invariant-explorer')
if (!(explorer instanceof HTMLElement)) {
	throw new Error('Invariant explorer controls are missing')
}

const searchInput = explorer.querySelector('[data-invariant-search]')
const typeSelect = explorer.querySelector('[data-invariant-type]')
const statusSelect = explorer.querySelector('[data-invariant-status]')
const subsystemSelect = explorer.querySelector('[data-invariant-subsystem]')
const count = explorer.querySelector('[data-invariant-count]')
const empty = explorer.querySelector('[data-invariant-empty]')
const expand = explorer.querySelector('[data-invariant-expand]')
const collapse = explorer.querySelector('[data-invariant-collapse]')
const reset = explorer.querySelector('[data-invariant-reset]')
if (
	!(searchInput instanceof HTMLInputElement) ||
	!(typeSelect instanceof HTMLSelectElement) ||
	!(statusSelect instanceof HTMLSelectElement) ||
	!(subsystemSelect instanceof HTMLSelectElement) ||
	!(count instanceof HTMLElement) ||
	!(empty instanceof HTMLElement) ||
	!(expand instanceof HTMLButtonElement) ||
	!(collapse instanceof HTMLButtonElement) ||
	!(reset instanceof HTMLButtonElement)
) {
	throw new Error('Invariant explorer is incomplete')
}

const entries = Array.from(document.querySelectorAll('details.invariant-entry'))
const entrySections = new Set()
const catalogContextSections = Array.from(document.querySelectorAll('#standing, section.callout'))

function normalizedText(value) {
	return value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}

function metadataValue(entry, label) {
	for (const item of entry.querySelectorAll('.invariant-metadata > div')) {
		if (normalizedText(item.querySelector('dt')?.textContent ?? '') !== normalizedText(label)) continue
		return item.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
	}
	return ''
}

function incrementCount(counts, value) {
	counts.set(value, (counts.get(value) ?? 0) + 1)
}

async function copyText(value) {
	try {
		await navigator.clipboard.writeText(value)
		return true
	} catch (error) {
		if (!(error instanceof DOMException) && !(error instanceof TypeError)) throw error
		const input = document.createElement('textarea')
		input.value = value
		input.setAttribute('readonly', '')
		input.style.position = 'fixed'
		input.style.opacity = '0'
		document.body.append(input)
		input.select()
		const copied = document.execCommand('copy')
		input.remove()
		return copied
	}
}

function permalink(entry) {
	const url = new URL(document.baseURI)
	url.search = ''
	url.hash = entry.id
	return url.href
}

function addEntryActions(entry) {
	const details = entry.querySelector('.invariant-details')
	if (!(details instanceof HTMLElement)) return
	const actions = document.createElement('div')
	actions.className = 'invariant-entry-actions'
	const link = document.createElement('a')
	link.href = `#${entry.id}`
	link.textContent = 'Permalink'
	const copy = document.createElement('button')
	copy.type = 'button'
	copy.textContent = 'Copy link'
	const status = document.createElement('span')
	status.className = 'invariant-copy-status'
	status.setAttribute('role', 'status')
	status.setAttribute('aria-live', 'polite')
	copy.addEventListener('click', async () => {
		const copied = await copyText(permalink(entry))
		status.textContent = copied ? 'Link copied.' : 'Copy failed.'
	})
	actions.append(link, copy, status)
	details.prepend(actions)
}

const typeCounts = new Map()
const statusCounts = new Map()
const subsystemCounts = new Map()
const subsystemLabels = new Map()

for (const entry of entries) {
	const identifier = entry.querySelector('summary code')?.textContent?.trim().toLowerCase()
	if (identifier === undefined || identifier.length === 0 || entry.id !== identifier) {
		throw new Error(`Invariant ${identifier ?? 'without identifier'} needs a matching stable fragment id`)
	}
	const type = metadataValue(entry, 'Type')
	const status = metadataValue(entry, 'Enforcement status')
	const section = entry.closest('section')
	const subsystem = section?.id ?? ''
	const subsystemLabel = section?.querySelector(':scope > h2')?.textContent?.trim() ?? subsystem
	entry.dataset.invariantType = type
	entry.dataset.invariantStatus = status
	entry.dataset.invariantSubsystem = subsystem
	entry.dataset.invariantSearchText = normalizedText(entry.textContent ?? '')
	if (section instanceof HTMLElement) entrySections.add(section)
	incrementCount(typeCounts, type)
	incrementCount(statusCounts, status)
	incrementCount(subsystemCounts, subsystem)
	subsystemLabels.set(subsystem, subsystemLabel)
	addEntryActions(entry)
}

function populateFacet(select, counts, labels = new Map()) {
	for (const [value, facetCount] of Array.from(counts.entries()).sort(([left], [right]) => (labels.get(left) ?? left).localeCompare(labels.get(right) ?? right))) {
		const option = document.createElement('option')
		option.value = value
		option.textContent = `${labels.get(value) ?? value} (${facetCount})`
		select.append(option)
	}
}

populateFacet(typeSelect, typeCounts)
populateFacet(statusSelect, statusCounts)
populateFacet(subsystemSelect, subsystemCounts, subsystemLabels)

function queryTokens() {
	return normalizedText(searchInput.value)
		.split(/[^a-z0-9_/-]+/)
		.filter(token => token.length > 0)
}

function matchesEntry(entry, tokens) {
	const matchesText = tokens.every(token => (entry.dataset.invariantSearchText ?? '').includes(token))
	const matchesType = typeSelect.value.length === 0 || entry.dataset.invariantType === typeSelect.value
	const matchesStatus = statusSelect.value.length === 0 || entry.dataset.invariantStatus === statusSelect.value
	const matchesSubsystem = subsystemSelect.value.length === 0 || entry.dataset.invariantSubsystem === subsystemSelect.value
	return matchesText && matchesType && matchesStatus && matchesSubsystem
}

function applyFilters() {
	const tokens = queryTokens()
	const hasActiveFilter = tokens.length > 0 || typeSelect.value.length > 0 || statusSelect.value.length > 0 || subsystemSelect.value.length > 0
	let visibleCount = 0
	for (const entry of entries) {
		const isVisible = matchesEntry(entry, tokens)
		entry.hidden = !isVisible
		if (isVisible) visibleCount += 1
	}
	for (const section of entrySections) {
		section.hidden = !entries.some(entry => entry.closest('section') === section && !entry.hidden)
	}
	for (const section of catalogContextSections) section.hidden = hasActiveFilter
	count.textContent = `${visibleCount} of ${entries.length} invariants`
	empty.hidden = visibleCount > 0
}

searchInput.addEventListener('input', applyFilters)
typeSelect.addEventListener('change', applyFilters)
statusSelect.addEventListener('change', applyFilters)
subsystemSelect.addEventListener('change', applyFilters)
expand.addEventListener('click', () => {
	for (const entry of entries) {
		if (!entry.hidden) entry.open = true
	}
})
collapse.addEventListener('click', () => {
	for (const entry of entries) entry.open = false
})
reset.addEventListener('click', () => {
	searchInput.value = ''
	typeSelect.value = ''
	statusSelect.value = ''
	subsystemSelect.value = ''
	applyFilters()
	searchInput.focus()
})

let targetId = window.location.hash.slice(1)
try {
	targetId = decodeURIComponent(targetId)
} catch (error) {
	if (!(error instanceof URIError)) throw error
}
const target = document.getElementById(targetId)
if (target instanceof HTMLDetailsElement && target.classList.contains('invariant-entry')) {
	target.open = true
	requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }))
}

applyFilters()
