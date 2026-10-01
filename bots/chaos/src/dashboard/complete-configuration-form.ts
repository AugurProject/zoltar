import { confirmOperatorAction, reviewChangeRows } from '@zoltar/bot-shared/dashboard/confirmation'
import { optionalRecord } from '@zoltar/bot-shared/infrastructure/json-validation'
import { requestJson, put } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import type { ReconcileUnknownMutation } from './dashboard-refresh.ts'

function element<T extends HTMLElement>(id: string, constructor: { new (): T }) {
	const value = document.getElementById(id)
	if (!(value instanceof constructor)) throw new Error(`Missing configuration control ${id}`)
	return value
}

/** The complete editor is generated from the owner configuration so newly supported fields cannot silently disappear. */
export function registerCompleteConfigurationForm(state: DashboardState, reconcile: ReconcileUnknownMutation) {
	const form = element('complete-configuration-form', HTMLFormElement)
	const fields = element('complete-configuration-fields', HTMLFieldSetElement)
	const content = element('complete-configuration-content', HTMLDivElement)
	const jsonMode = element('complete-configuration-json-mode', HTMLInputElement)
	const jsonInput = element('complete-configuration-json', HTMLTextAreaElement)
	const jsonLabel = element('complete-configuration-json-label', HTMLLabelElement)
	const status = element('complete-configuration-status', HTMLSpanElement)
	const load = element('load-complete-configuration', HTMLButtonElement)
	const save = element('save-complete-configuration', HTMLButtonElement)
	let revision: unknown
	let settings: Record<string, unknown> | undefined
	let baseline: unknown
	const readers: (() => void)[] = []
	let busy = false
	let locked = false
	let committed = false
	let dirty = false
	let attemptedRevision: unknown
	fields.addEventListener('input', () => {
		dirty = true
	})

	function renderRecord(value: Record<string, unknown>, parent: HTMLElement, path = '') {
		for (const [key, original] of Object.entries(value)) {
			const name = path === '' ? key : `${path}.${key}`
			if (['privateKey', 'paused', 'version', 'runtime.execute'].includes(name)) continue
			const child = optionalRecord(original)
			if (child !== undefined) {
				value[key] = child
				const group = document.createElement('fieldset')
				group.className = 'complete-configuration-group field-grid-wide'
				const legend = document.createElement('legend')
				legend.textContent = key === 'deploymentPin' ? 'Contract addresses' : key.charAt(0).toUpperCase() + key.slice(1)
				group.append(legend)
				const grid = document.createElement('div')
				grid.className = 'field-grid'
				group.append(grid)
				parent.append(group)
				renderRecord(child, grid, name)
				continue
			}
			const label = document.createElement('label')
			const title = document.createElement('span')
			title.textContent = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^(.)/, first => first.toUpperCase())
			label.append(title)
			parent.append(label)
			if (Array.isArray(original) || original === null) {
				const input = document.createElement('textarea')
				input.dataset['configurationPath'] = name
				input.rows = 3
				input.value = JSON.stringify(original, undefined, 2)
				input.spellcheck = false
				input.setAttribute('aria-label', `${name} (JSON)`)
				label.append(input)
				readers.push(() => {
					try {
						value[key] = JSON.parse(input.value)
					} catch (error) {
						if (!(error instanceof SyntaxError)) throw error
						throw new Error(`${name} must be valid JSON.`)
					}
				})
			} else {
				const input = document.createElement('input')
				if (typeof original === 'boolean') label.className = 'switch-field'
				if (typeof original === 'boolean') input.type = 'checkbox'
				else if (typeof original === 'number') input.type = 'number'
				else input.type = 'text'
				if (typeof original === 'boolean') input.checked = original
				else input.value = String(original)
				input.dataset['configurationPath'] = name
				input.autocomplete = 'off'
				input.spellcheck = false
				if (typeof original === 'boolean') label.replaceChildren(input, title)
				else label.append(input)
				readers.push(() => {
					if (typeof original === 'boolean') value[key] = input.checked
					else if (typeof original === 'number') value[key] = Number(input.value)
					else value[key] = input.value
				})
			}
		}
	}

	function renderAvailability() {
		if (committed && state.configuration !== undefined && state.configuration.revision !== revision) {
			locked = false
			committed = false
			dirty = false
			attemptedRevision = undefined
		}
		const paused = state.configuration?.paused === true && state.snapshot?.paused === true
		fields.disabled = busy || locked || settings === undefined || !paused || state.configurationCommitIndeterminate || state.settingsMutationUnreconciled
		save.disabled = fields.disabled
		load.disabled = busy || locked || state.configurationCommitIndeterminate || state.configuration?.completeConfigurationAvailable !== true
		if (settings !== undefined && revision !== state.configuration?.revision && !busy && !locked) {
			save.disabled = true
			status.textContent = 'Configuration changed. Discard this draft before saving.'
		}
		if (!busy && !locked && !dirty && state.configuration?.completeConfigurationAvailable === true && attemptedRevision !== state.configuration.revision && window.location.pathname === '/settings') void loadDocument()
	}
	jsonMode.addEventListener('change', () => {
		try {
			if (jsonMode.checked) {
				for (const read of readers) read()
				jsonInput.value = JSON.stringify(settings, undefined, 2)
			} else {
				const document = optionalRecord(JSON.parse(jsonInput.value))
				if (document === undefined) throw new Error('Configuration must be a JSON object.')
				settings = document
				readers.length = 0
				content.replaceChildren()
				renderRecord(document, content)
			}
			content.classList.toggle('hidden', jsonMode.checked)
			jsonLabel.classList.toggle('hidden', !jsonMode.checked)
			if (status.textContent === '' || status.textContent === 'Arrays and empty optional values use JSON.') status.textContent = jsonMode.checked ? '' : 'Arrays and empty optional values use JSON.'
		} catch (error) {
			jsonMode.checked = !jsonMode.checked
			status.textContent = error instanceof Error ? error.message : 'Configuration could not be parsed.'
		}
	})
	async function loadDocument() {
		attemptedRevision = state.configuration?.revision
		busy = true
		renderAvailability()
		status.textContent = 'Loading configuration…'
		try {
			const response = optionalRecord(await requestJson('/api/configuration-document', 5_000))
			const document = optionalRecord(response?.['settings'])
			if (document === undefined) throw new Error('Complete configuration is unavailable in this launcher.')
			dirty = false
			load.textContent = 'Discard changes'
			settings = document
			baseline = structuredClone(document)
			revision = response?.['revision']
			readers.length = 0
			content.replaceChildren()
			renderRecord(document, content)
			jsonInput.value = JSON.stringify(document, undefined, 2)
			status.textContent = jsonMode.checked ? '' : 'Arrays and empty optional values use JSON.'
		} catch (error) {
			load.textContent = 'Retry'
			status.textContent = error instanceof Error ? error.message : 'Configuration could not be loaded.'
		} finally {
			busy = false
			renderAvailability()
		}
	}
	load.addEventListener('click', () => {
		void loadDocument()
	})
	form.addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			if (settings === undefined || busy || locked) return
			try {
				if (jsonMode.checked) {
					settings = optionalRecord(JSON.parse(jsonInput.value))
					if (settings === undefined) throw new Error('Configuration must be a JSON object.')
				} else for (const read of readers) read()
				if (
					!(await confirmOperatorAction({
						title: 'Save complete configuration',
						description: 'Save these settings and restart the bot paused with live execution off. Signer, chain, or deployment changes preserve the old state and use a separate state file. Changing the dashboard port or disabling it will disconnect this page.',
						changes: reviewChangeRows(baseline, settings),
						phrase: 'SAVE CONFIGURATION',
						confirmLabel: 'Save and restart',
					}))
				)
					return
				busy = true
				renderAvailability()
				status.textContent = 'Checking and saving configuration…'
				await put('/api/configuration-document', { settings, revision }, 30_000)
				locked = true
				committed = true
				status.textContent = 'Saved. The bot is restarting paused with live execution off. This page reconnects automatically at the same address; open the new address if you changed the dashboard binding.'
			} catch (error) {
				const result = await reconcile(error, status, 'configuration and state', 'settings')
				locked = result.handled && !result.reconciled
				if (!result.handled) status.textContent = error instanceof Error ? error.message : 'Configuration could not be saved.'
			} finally {
				busy = false
				renderAvailability()
			}
		})()
	})
	return { renderAvailability }
}
