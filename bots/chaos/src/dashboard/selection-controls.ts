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
	let pending = false
	let clearScheduleNotice = false
	const update = (value: ControlState) => {
		state = value
		if (clearScheduleNotice && !pending) {
			scheduleStatus.textContent = ''
			clearScheduleNotice = false
		}
		document.querySelector('#catalog-selection-note')?.classList.toggle('hidden', state.paused)
		run.disabled = pending || !state.available || state.frozen || state.scheduledAt === undefined
		for (const toggle of document.querySelectorAll('[data-selection-toggle]')) {
			if (!(toggle instanceof HTMLInputElement)) continue
			toggle.disabled = pending || !state.available || state.frozen || !state.paused || state.selection === undefined
			toggle.checked = state.selection === null || state.selection?.includes(toggle.dataset['selectionToggle'] ?? '') === true
		}
	}
	const mutate = async (path: string, body: unknown, status: HTMLElement, success: string) => {
		let saved = false
		clearScheduleNotice = false
		pending = true
		update(state)
		status.textContent = 'Saving…'
		try {
			await options.put(path, body)
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
			pending = false
			update(state)
			clearScheduleNotice = saved && path === '/api/schedule'
		}
	}
	run.addEventListener('click', () => {
		if (run.disabled) return
		void mutate('/api/schedule', { revision: state.revision, nextRunAt: state.scheduledAt }, scheduleStatus, 'Next choice requested.')
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
				void mutate('/api/selection', { revision: state.revision, operationId: id, enabled: toggle.checked }, selectionStatus, 'Random selection saved.')
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
