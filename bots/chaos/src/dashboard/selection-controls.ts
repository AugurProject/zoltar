type ControlState = {
	available: boolean
	frozen: boolean
	paused: boolean
	revision: string | number | undefined
	selection: string[] | null | undefined
	scheduledAt: string | undefined
}

type SelectionControlsOptions = {
	put: (path: string, value: unknown) => Promise<unknown>
	refresh: () => Promise<unknown>
	reconcile: (error: unknown, status: HTMLElement) => Promise<{ handled: boolean }>
}

export function createSelectionControls(options: SelectionControlsOptions) {
	const run = document.querySelector('#run-next-now')
	const scheduleStatus = document.querySelector('#schedule-action-status')
	const selectionStatus = document.querySelector('#catalog-selection-status')
	if (!(run instanceof HTMLButtonElement) || !(scheduleStatus instanceof HTMLElement) || !(selectionStatus instanceof HTMLElement)) throw new Error('Selection controls are missing')
	let state: ControlState = { available: false, frozen: false, paused: false, revision: undefined, selection: undefined, scheduledAt: undefined }
	let pendingCount = 0
	const pendingToggleIds = new Set<string>()
	let clearScheduleNotice = false
	let queue: Promise<void> = Promise.resolve()
	const update = (value: ControlState) => {
		state = value
		if (clearScheduleNotice && pendingCount === 0) {
			scheduleStatus.textContent = ''
			clearScheduleNotice = false
		}
		document.querySelector('#catalog-selection-note')?.classList.toggle('hidden', state.paused)
		run.disabled = pendingCount !== 0 || !state.available || state.frozen || state.scheduledAt === undefined
		for (const toggle of document.querySelectorAll('[data-selection-toggle]')) {
			if (!(toggle instanceof HTMLInputElement)) continue
			const id = toggle.dataset['selectionToggle'] ?? ''
			// Only toggles awaiting their own save are disabled, and their checked state is left
			// alone until the save lands. Disabling and rewriting every toggle for each save made
			// the whole catalog flicker between checked/enabled and unchecked/disabled styling.
			const awaitingSave = pendingToggleIds.has(id)
			toggle.disabled = awaitingSave || !state.available || state.frozen || !state.paused || state.selection === undefined
			if (!awaitingSave) toggle.checked = state.selection === null || state.selection?.includes(id) === true
		}
	}
	const mutate = async (path: string, body: () => unknown, status: HTMLElement, success: string, toggleId?: string) => {
		let saved = false
		clearScheduleNotice = false
		update(state)
		status.textContent = 'Saving…'
		try {
			await options.put(path, body())
			status.textContent = success
			await options.refresh()
			saved = true
		} catch (error) {
			const result = await options.reconcile(error, status)
			if (!result.handled) {
				status.textContent = error instanceof Error ? error.message : 'The change could not be saved.'
				await options.refresh()
			}
		} finally {
			pendingCount -= 1
			if (toggleId !== undefined) pendingToggleIds.delete(toggleId)
			update(state)
			clearScheduleNotice = saved && path === '/api/schedule'
		}
	}
	// Saves are serialized so that each one reads the revision left behind by the previous refresh.
	const enqueue = (path: string, body: () => unknown, status: HTMLElement, success: string, toggleId?: string) => {
		if (toggleId !== undefined) pendingToggleIds.add(toggleId)
		pendingCount += 1
		update(state)
		// A rejected link must not poison the chain and strand every later save.
		const save = async () => {
			await mutate(path, body, status, success, toggleId)
		}
		queue = queue.then(save).catch(() => undefined)
	}
	run.addEventListener('click', () => {
		if (run.disabled) return
		enqueue('/api/schedule', () => ({ revision: state.revision, nextRunAt: state.scheduledAt }), scheduleStatus, 'Next choice requested.')
	})
	return {
		update,
		appendToggle: (container: HTMLElement, id: string, name: string) => {
			const label = document.createElement('label')
			label.className = 'operation-selection'
			const toggle = document.createElement('input')
			toggle.type = 'checkbox'
			toggle.dataset['selectionToggle'] = id
			toggle.setAttribute('aria-label', `Enable random selection for ${name}`)
			toggle.addEventListener('change', () => {
				if (toggle.disabled) return
				const enabled = toggle.checked
				enqueue('/api/selection', () => ({ revision: state.revision, operationId: id, enabled }), selectionStatus, 'Random selection saved.', id)
			})
			label.append(toggle, ' Random selection')
			container.append(label)
			update(state)
		},
	}
}

export function activeSchedulerWorkLabel(value: { pendingTransactions: readonly unknown[]; currentWorkflow?: { status?: string | undefined } | undefined }) {
	if (value.pendingTransactions.length !== 0 || value.currentWorkflow?.status === 'waiting-transaction') return 'Transaction recovery pending'
	if (value.currentWorkflow?.status === 'waiting-continuation') return 'Workflow continuation pending'
	if (value.currentWorkflow?.status === 'waiting-obligation') return 'Lifecycle confirmation pending'
	if (value.currentWorkflow?.status === 'running') return 'Operation in progress'
	return undefined
}
