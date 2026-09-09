type Operation = { id?: string | undefined; label?: string | undefined; description?: string | undefined; blockers: string[] }
type Input = { source: 'chaosbot' } | { source: 'custom'; value: string }
type Result = {
	blockers: string[]
	candidates: Array<{ value: string; label: string }>
	fields: Array<{ key: string; label: string; value: string }>
	mode: string
	previewId: string | undefined
	expiresAt: number | undefined
	steps: Array<{ label: string; to: string; value: string; method: string; arguments: string }>
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Operation response unavailable')
	return Object.fromEntries(Object.entries(value))
}

function string(value: unknown) {
	return typeof value === 'string' ? value : ''
}

function result(value: unknown): Result {
	const source = record(value)
	return {
		blockers: Array.isArray(source['blockers']) ? source['blockers'].map(string) : [],
		candidates: Array.isArray(source['candidates'])
			? source['candidates'].map(value => {
					const item = record(value)
					return { value: string(item['value']), label: string(item['label']) }
				})
			: [],
		fields: Array.isArray(source['fields'])
			? source['fields'].map(value => {
					const item = record(value)
					return { key: string(item['key']), label: string(item['label']), value: string(item['value']) }
				})
			: [],
		mode: string(source['mode']),
		expiresAt: typeof source['expiresAt'] === 'number' ? source['expiresAt'] : undefined,
		previewId: typeof source['previewId'] === 'string' ? source['previewId'] : undefined,
		steps: Array.isArray(source['steps'])
			? source['steps'].map(value => {
					const item = record(value)
					return { label: string(item['label']), to: string(item['to']), value: string(item['value']), method: string(item['method']), arguments: string(item['arguments']) }
				})
			: [],
	}
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
	const node = document.createElement(tag)
	if (text !== undefined) node.textContent = text
	return node
}

export function createOperationDialog(options: { request: (value: unknown) => Promise<unknown> }) {
	const dialog = element('dialog')
	dialog.className = 'operation-dialog'
	dialog.id = 'operation-dialog'
	dialog.setAttribute('aria-labelledby', 'operation-dialog-title')
	const title = element('h2')
	title.id = 'operation-dialog-title'
	const close = element('button', 'Close')
	close.type = 'button'
	close.className = 'secondary'
	close.addEventListener('click', () => dialog.close())
	const heading = element('div')
	heading.className = 'section-heading'
	heading.append(title, close)
	const description = element('p')
	const form = element('form')
	const fields = element('fieldset')
	fields.className = 'operation-inputs'
	const mode = element('p')
	const status = element('p')
	status.setAttribute('role', 'status')
	status.setAttribute('aria-live', 'polite')
	const transactions = element('div')
	transactions.className = 'operation-transactions'
	const preview = element('button', 'Preview operation')
	preview.type = 'submit'
	preview.className = 'secondary'
	const execute = element('button', 'Execute operation')
	execute.type = 'button'
	execute.disabled = true
	const retry = element('button', 'Retry')
	retry.type = 'button'
	retry.hidden = true
	const actions = element('div')
	actions.className = 'operation-actions'
	actions.append(preview, execute, retry)
	const workflowLink = element('a', 'View workflow and activity')
	workflowLink.href = '/overview#current-workflow'
	workflowLink.className = 'text-link'
	workflowLink.hidden = true
	form.append(fields, mode, transactions, status, actions, workflowLink)
	dialog.append(heading, description, form)
	document.body.append(dialog)
	let selected: Operation | undefined
	let generation = 0
	let previewId: string | undefined
	let inputs: Record<string, Input> = {}
	let candidate: string | undefined
	let busy = false
	let executionReference: string | undefined
	const retainedExecutions = new Map<string, string>()

	function invalidate() {
		previewId = undefined
		execute.disabled = true
		transactions.replaceChildren()
		status.textContent = 'Preview your changes before execution.'
	}

	function inputControl(key: string, labelText: string, value: string, choices?: Array<{ label: string; value: string }>) {
		const wrapper = element('div')
		wrapper.className = 'operation-input'
		const label = element('label', labelText)
		const source = element('select')
		source.setAttribute('aria-label', `${labelText} source`)
		source.append(new Option('Use chaosbot input', 'chaosbot'), new Option('Custom value', 'custom'))
		const input = choices === undefined ? element('input') : element('select')
		input.id = `operation-input-${key}`
		label.htmlFor = input.id
		if (input instanceof HTMLSelectElement) for (const choice of choices ?? []) input.append(new Option(choice.label, choice.value))
		else {
			input.type = 'text'
			input.inputMode = 'numeric'
			input.autocomplete = 'off'
		}
		input.value = inputs[key]?.source === 'custom' ? inputs[key].value : value
		source.value = inputs[key]?.source ?? 'chaosbot'
		input.disabled = source.value === 'chaosbot'
		const update = () => {
			input.disabled = source.value === 'chaosbot'
			inputs[key] = source.value === 'chaosbot' ? { source: 'chaosbot' } : { source: 'custom', value: input.value }
			if (key === 'candidate') candidate = source.value === 'custom' ? input.value : undefined
			invalidate()
		}
		source.addEventListener('change', () => {
			if (source.value === 'chaosbot') input.value = value
			update()
		})
		input.addEventListener('input', update)
		wrapper.append(label, source, input)
		return wrapper
	}

	function show(value: Result) {
		const advanced = element('details')
		advanced.className = 'operation-limits'
		advanced.append(element('summary', 'Limits and reserves'))
		fields.replaceChildren()
		for (const field of value.fields) {
			const control = inputControl(field.key, field.label, field.value)
			if (field.key.startsWith('minimum')) advanced.append(control)
			else fields.append(control)
		}
		if (advanced.childElementCount > 1) fields.append(advanced)
		if (value.candidates.length !== 0) fields.prepend(inputControl('candidate', 'Lifecycle candidate', value.candidates[0]?.value ?? '', value.candidates))
		mode.hidden = value.fields.length === 0
		mode.textContent = value.mode === 'live' ? 'Live execution · transactions will be signed by the configured bot signer.' : 'Dry run · no transactions will be signed.'
		previewId = value.previewId
		if (value.expiresAt !== undefined && previewId !== undefined) {
			const reference = previewId
			window.setTimeout(
				() => {
					if (previewId === reference) {
						invalidate()
						status.textContent = 'Preview expired. Preview the operation again.'
					}
				},
				Math.max(0, value.expiresAt - Date.now()),
			)
		}
		execute.textContent = value.mode === 'live' ? 'Execute operation' : 'Run dry run'
		preview.disabled = value.fields.length === 0
		execute.disabled = previewId === undefined
		status.textContent = [...new Set([...value.blockers, ...(value.fields.length === 0 ? (selected?.blockers ?? []) : [])])].join('. ')
		transactions.replaceChildren()
		if (value.steps.length !== 0) {
			transactions.append(element('h3', 'Transaction preview'))
			for (const step of value.steps) {
				const details = element('details')
				details.append(element('summary', step.label))
				details.append(element('p', `To: ${step.to}`), element('p', `ETH value: ${step.value} wei`), element('p', step.method), element('pre', step.arguments))
				transactions.append(details)
			}
		}
	}

	async function load(action: 'inspect' | 'preview') {
		if (selected === undefined || busy) return
		const requestGeneration = generation
		busy = true
		fields.disabled = true
		preview.disabled = true
		execute.disabled = true
		retry.hidden = true
		previewId = undefined
		status.textContent = 'Preparing operation…'
		try {
			const submitted = Object.fromEntries(Object.entries(inputs).filter(([key]) => key !== 'candidate'))
			const value = result(await options.request({ action, definitionId: selected.id, inputs: submitted, ...(candidate === undefined ? {} : { candidate }) }))
			if (requestGeneration !== generation) return
			show(value)
		} catch (error) {
			if (requestGeneration !== generation) return
			status.textContent = error instanceof Error ? error.message : 'Operation unavailable'
			retry.hidden = false
			preview.disabled = false
		} finally {
			if (requestGeneration === generation) {
				busy = false
				fields.disabled = false
			}
		}
	}

	async function poll(reference: string, requestGeneration: number) {
		if (requestGeneration !== generation || !dialog.open) return
		try {
			const response = record(await options.request({ action: 'status', previewId: reference }))
			if (requestGeneration !== generation) return
			if (response['execution'] === null) {
				status.textContent = 'Execution status unavailable. Check Activity and the current workflow before retrying.'
				busy = false
				fields.disabled = false
				preview.disabled = false
				if (selected?.id !== undefined) retainedExecutions.delete(selected.id)
				return
			}
			const execution = record(response['execution'])
			status.textContent = string(execution['message'])
			if (execution['status'] === 'pending') window.setTimeout(() => void poll(reference, requestGeneration), 1500)
			else {
				busy = false
				fields.disabled = false
				preview.disabled = false
				if (selected?.id !== undefined) retainedExecutions.delete(selected.id)
				executionReference = undefined
			}
		} catch {
			if (requestGeneration !== generation) return
			status.textContent = 'Checking execution status failed. Retrying…'
			window.setTimeout(() => void poll(reference, requestGeneration), 3000)
		}
	}

	form.addEventListener('submit', event => {
		event.preventDefault()
		void load('preview')
	})
	retry.addEventListener('click', () => void load('inspect'))
	execute.addEventListener('click', () => {
		if (previewId === undefined || selected?.id === undefined || busy) return
		const reference = previewId
		const requestGeneration = generation
		retainedExecutions.set(selected.id, reference)
		executionReference = reference
		previewId = undefined
		busy = true
		fields.disabled = true
		preview.disabled = true
		execute.disabled = true
		workflowLink.hidden = false
		status.textContent = 'Starting operation…'
		void options.request({ action: 'execute', previewId: reference }).then(
			() => poll(reference, requestGeneration),
			error => {
				if (requestGeneration !== generation) return
				if (error instanceof Error && error.name === 'MutationOutcomeUnknown') {
					void poll(reference, requestGeneration)
					return
				}
				if (selected?.id !== undefined) retainedExecutions.delete(selected.id)
				busy = false
				fields.disabled = false
				preview.disabled = false
				status.textContent = error instanceof Error ? error.message : 'Execution could not start. Preview the operation again.'
			},
		)
	})
	dialog.addEventListener('close', () => {
		if (!dialog.open) {
			generation += 1
			busy = false
		}
	})
	return {
		open(operation: Operation) {
			generation += 1
			selected = operation
			title.textContent = operation.label ?? 'Operation'
			description.textContent = operation.description ?? ''
			inputs = {}
			candidate = undefined
			previewId = undefined
			fields.replaceChildren()
			transactions.replaceChildren()
			mode.textContent = ''
			workflowLink.hidden = true
			status.textContent = operation.blockers.join('. ')
			execute.disabled = true
			busy = false
			dialog.showModal()
			executionReference = operation.id === undefined ? undefined : retainedExecutions.get(operation.id)
			if (executionReference !== undefined) {
				workflowLink.hidden = false
				busy = true
				fields.disabled = true
				preview.disabled = true
				void poll(executionReference, generation)
			} else void load('inspect')
		},
	}
}
