const entries = Array.from(document.querySelectorAll('details.invariant-entry'))

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

for (const entry of entries) {
	const identifier = entry.querySelector('summary code')?.textContent?.trim().toLowerCase()
	if (identifier === undefined || identifier.length === 0 || entry.id !== identifier) {
		throw new Error(`Invariant ${identifier ?? 'without identifier'} needs a matching stable fragment id`)
	}
	addEntryActions(entry)
}

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
