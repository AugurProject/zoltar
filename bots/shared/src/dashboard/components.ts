export function setAttentionBadge(element: HTMLAnchorElement, count: number, target: string) {
	const label = count === 0 ? 'No blockers' : `${count.toString()} ${count === 1 ? 'action' : 'actions'}`
	if (element.textContent !== label) element.textContent = label
	element.className = 'badge attention-badge'
	element.dataset['tone'] = count === 0 ? 'ok' : 'warning'
	if (count === 0) element.removeAttribute('href')
	else element.setAttribute('href', target)
}

export function createMetric(label: string, value: string, detail?: string) {
	const container = document.createElement('dl')
	container.className = 'metric'
	const term = document.createElement('dt')
	term.textContent = label
	const description = document.createElement('dd')
	description.textContent = value
	container.append(term, description)
	if (detail !== undefined) {
		const note = document.createElement('dd')
		note.className = 'metric-detail'
		note.textContent = detail
		container.append(note)
	}
	return container
}
