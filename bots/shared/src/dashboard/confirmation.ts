import { h, render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

type Change = { label: string; before: string; after: string }
type Evidence = { label: string; value: string }

function reviewLabel(path: string) {
	const parts = path.split(' › ').filter(part => part !== 'Setting' && part !== 'root')
	const labels: string[] = []
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index] ?? ''
		const collection = { children: 'Child market', desiredPools: 'Desired pool', dexSources: 'DEX source', pools: 'Pool', sources: 'Source' }[part]
		if (collection !== undefined && /^\d+$/.test(parts[index + 1] ?? '')) {
			labels.push(`${collection} ${parts[++index]}`)
			continue
		}
		const words = part
			.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
			.split(' ')
			.map(word => ({ eth: 'ETH', id: 'ID', rep: 'REP', weth: 'WETH' })[word.toLowerCase()] ?? word.toLowerCase())
		const label = words.join(' ')
		labels.push(label.charAt(0).toUpperCase() + label.slice(1))
	}
	return labels.join(' · ') || 'Setting'
}

export function reviewChangeRows(before: unknown, after: unknown, path = 'Setting'): Change[] {
	const object = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined)
	const oldObject = object(before)
	const newObject = object(after)
	if (oldObject !== undefined || newObject !== undefined) return [...new Set([...Object.keys(oldObject ?? {}), ...Object.keys(newObject ?? {})])].flatMap(key => reviewChangeRows(oldObject?.[key], newObject?.[key], `${path} › ${key}`))
	if (Array.isArray(before) || Array.isArray(after)) {
		const oldArray = Array.isArray(before) ? before : []
		const newArray = Array.isArray(after) ? after : []
		return Array.from({ length: Math.max(oldArray.length, newArray.length) }, (_, index) => reviewChangeRows(oldArray[index], newArray[index], `${path} › ${index + 1}`)).flat()
	}
	const display = (value: unknown) => {
		if (value === undefined || value === null) return '—'
		return String(value)
	}
	return display(before) === display(after) ? [] : [{ label: reviewLabel(path), before: display(before), after: display(after) }]
}

type Confirmation = {
	title: string
	description: string
	phrase?: string | undefined
	changes?: readonly Change[] | undefined
	evidence?: readonly Evidence[] | undefined
	confirmLabel?: string | undefined
}

let active = false

export function confirmOperatorAction(options: Confirmation): Promise<boolean> {
	if (active) return Promise.resolve(false)
	active = true
	return new Promise(resolve => {
		const mount = document.createElement('div')
		document.body.append(mount)
		function finish(confirmed: boolean) {
			render(null, mount)
			mount.remove()
			active = false
			void resolve(confirmed)
		}
		function Dialog() {
			const dialog = useRef<HTMLDialogElement>(null)
			const [typed, setTyped] = useState('')
			useEffect(() => {
				dialog.current?.showModal()
			}, [])
			return h(
				'dialog',
				{
					ref: dialog,
					class: 'operator-confirm-dialog',
					'aria-label': options.title,
					onCancel: (event: Event) => {
						event.preventDefault()
						finish(false)
					},
				},
				h(
					'form',
					{
						method: 'dialog',
						onSubmit: (event: Event) => {
							event.preventDefault()
							finish(true)
						},
					},
					h('h2', null, options.title),
					h('p', null, options.description),
					(options.changes?.length ?? 0) + (options.evidence?.length ?? 0) === 0
						? undefined
						: h(
								'div',
								{ class: 'operator-review-rows' },
								...(options.changes ?? []).map(change => h('div', { class: 'operator-review-row', key: change.label }, h('strong', null, change.label), h('span', null, change.before), h('span', { 'aria-hidden': true }, '→'), h('span', null, change.after))),
								options.evidence === undefined || options.evidence.length === 0
									? undefined
									: h('section', { class: 'operator-evidence', 'aria-label': 'Existing evidence' }, h('h3', null, 'Existing evidence'), h('dl', null, ...options.evidence.map(item => h('div', { class: 'operator-evidence-row', key: item.label }, h('dt', null, item.label), h('dd', null, item.value))))),
							),
					options.phrase === undefined
						? undefined
						: h(
								'label',
								null,
								h('span', null, 'Type ', h('strong', { class: 'mono' }, options.phrase), ' to confirm'),
								h('input', {
									id: 'operator-confirm-phrase',
									autoComplete: 'off',
									value: typed,
									onInput: (event: Event) => {
										if (event.currentTarget instanceof HTMLInputElement) setTyped(event.currentTarget.value)
									},
								}),
							),
					h(
						'div',
						{ class: 'dialog-actions' },
						h('button', { type: 'button', class: 'secondary', onClick: () => finish(false) }, 'Cancel'),
						h('button', { id: 'operator-confirm-submit', type: 'submit', class: 'danger', disabled: options.phrase !== undefined && typed !== options.phrase }, options.confirmLabel ?? 'Confirm'),
					),
				),
			)
		}
		render(h(Dialog, null), mount)
	})
}
