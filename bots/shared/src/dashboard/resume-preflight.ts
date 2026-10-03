function requiredElement(id: string) {
	const value = document.getElementById(id)
	if (!(value instanceof HTMLElement)) throw new Error(`Missing dashboard element #${id}`)
	return value
}

function preflightItem(label: string, value: string) {
	const item = document.createElement('li')
	const name = document.createElement('span')
	name.textContent = label
	const status = document.createElement('strong')
	status.textContent = value
	item.append(name, status)
	return item
}

function renderPreflightRows(rows: readonly (readonly [string, string])[]) {
	requiredElement('resume-preflight').replaceChildren(...rows.map(([label, value]) => preflightItem(label, value)))
}

/** Rewrites the rows of an open resume preflight from newer state; a closed dialog is left untouched. */
export function updateResumePreflight(rows: readonly (readonly [string, string])[]) {
	if (requiredElement('resume-dialog').hasAttribute('open')) renderPreflightRows(rows)
}

export function openResumePreflight(rows: readonly (readonly [string, string])[]) {
	renderPreflightRows(rows)
	const dialog = requiredElement('resume-dialog')
	if ('showModal' in dialog && typeof dialog.showModal === 'function') dialog.showModal()
	if (!dialog.hasAttribute('open')) dialog.setAttribute('open', '')
	requiredElement('resume-title').focus({ preventScroll: true })
	dialog.scrollTop = 0
}

export function closeResumePreflight() {
	const dialog = requiredElement('resume-dialog')
	if (dialog.hasAttribute('open') && 'close' in dialog && typeof dialog.close === 'function') dialog.close()
	else dialog.removeAttribute('open')
}
