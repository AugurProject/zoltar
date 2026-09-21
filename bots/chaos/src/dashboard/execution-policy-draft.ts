type DraftControls = {
	fields: HTMLFieldSetElement
	selectAll: HTMLInputElement
	allowlist: HTMLTextAreaElement
	discard: HTMLButtonElement
	status: HTMLSpanElement
	reload: () => void
}

/** Tracks unsaved execution-policy edits: the panel badge shows while a draft differs from the loaded configuration. */
export function createExecutionPolicyDraft(controls: DraftControls) {
	const unsaved = document.getElementById('settings-draft-status')
	if (!(unsaved instanceof HTMLSpanElement)) throw new Error('Execution policy feedback is missing')
	const draft = {
		dirty: false,
		conflict: false,
		render: () => {
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
