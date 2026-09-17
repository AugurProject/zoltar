type DraftControls = {
	fields: HTMLFieldSetElement
	selectAll: HTMLInputElement
	allowlist: HTMLTextAreaElement
	execute: HTMLInputElement
	discard: HTMLButtonElement
	status: HTMLSpanElement
	currentMode: () => boolean | undefined
	reload: () => void
}

export function createExecutionPolicyDraft(controls: DraftControls) {
	const current = document.getElementById('execution-current-mode')
	const selection = document.getElementById('execution-draft-mode')
	const unsaved = document.getElementById('settings-draft-status')
	if (!(current instanceof HTMLParagraphElement) || !(selection instanceof HTMLParagraphElement) || !(unsaved instanceof HTMLSpanElement)) throw new Error('Execution policy feedback is missing')
	const draft = {
		dirty: false,
		conflict: false,
		render: () => {
			const active = controls.currentMode()
			current.textContent = active === undefined ? 'Current mode: Unavailable' : `Current mode: ${active ? 'Live execution' : 'Dry run'}`
			selection.hidden = !draft.dirty || controls.execute.checked === active
			selection.textContent = selection.hidden ? '' : `${controls.execute.checked ? 'Live execution' : 'Dry run'} selected · not applied`
			unsaved.hidden = !draft.dirty
		},
	}
	controls.fields.addEventListener('input', () => {
		draft.dirty = true
		controls.discard.disabled = false
		if (!draft.conflict) controls.status.textContent = ''
		draft.render()
	})
	controls.selectAll.addEventListener('input', () => {
		controls.allowlist.disabled = controls.selectAll.checked
	})
	controls.discard.addEventListener('click', () => {
		draft.dirty = false
		draft.conflict = false
		controls.status.textContent = 'Local edits discarded. Current configuration loaded.'
		controls.reload()
	})
	return draft
}
