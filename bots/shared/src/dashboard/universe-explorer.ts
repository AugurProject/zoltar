import { indexUniverseTree, universeApprovalSelection, universeLabel, universeLineage, visibleUniverseRows, type UniverseNode } from './universe-tree.ts'

const PAGE_SIZE = 60
function compact(value: string) {
	return value.length > 22 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

type ExplorerState = {
	universes: readonly UniverseNode[]
	approved: ReadonlySet<string>
	network: string
	disabled: boolean
}

export function createUniverseExplorer(host: HTMLElement, options: { onChange: (next: Set<string>) => void | Promise<void>; savedMessage: string }) {
	const document = host.ownerDocument
	const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
		const element = document.createElement(tag)
		element.className = className
		if (text !== undefined) element.textContent = text
		return element
	}
	const button = (className: string, text: string, action: () => void) => {
		const element = make('button', className, text)
		element.type = 'button'
		element.addEventListener('click', action)
		return element
	}
	host.className = 'universe-explorer'
	const toolbar = make('div', 'ue-toolbar')
	const searchLabel = make('label', 'ue-search-label')
	searchLabel.append(make('span', 'ue-label', 'Find a universe'))
	const search = make('input', 'ue-search')
	search.type = 'search'
	search.placeholder = 'Universe ID, REP address or outcome'
	searchLabel.append(search)
	const filterLabel = make('label', 'ue-filter-label')
	filterLabel.append(make('span', 'ue-label', 'Show'))
	const filter = make('select', 'ue-filter')
	for (const [value, text] of [
		['all', 'All universes'],
		['approved', 'Approved only'],
	]) {
		const option = make('option', '', text)
		option.value = value ?? ''
		filter.append(option)
	}
	filterLabel.append(filter)
	toolbar.append(searchLabel, filterLabel)
	const context = make('div', 'ue-context')
	const count = make('span', 'ue-count')
	const collapse = button('ue-text-button', 'Collapse branches', () => {
		expanded.clear()
		if (branchRoot !== undefined) for (const root of tree.roots) expanded.add(root.id)
		branchRoot = undefined
		render()
	})
	context.append(count, collapse)
	const layout = make('div', 'ue-layout')
	const browser = make('div', 'ue-browser')
	const list = make('ul', 'ue-list')
	list.setAttribute('aria-label', 'Universe lineage')
	const empty = make('p', 'ue-empty')
	const more = button('ue-more', 'Show more', () => {
		limit += PAGE_SIZE
		render()
	})
	browser.append(list, empty, more)
	const detail = make('aside', 'ue-detail')
	detail.setAttribute('aria-label', 'Universe details')
	layout.append(browser, detail)
	const status = make('p', 'ue-status')
	status.setAttribute('role', 'status')
	const guidance = make('p', 'ue-guidance', 'Approving a path selects its ancestors and replaces competing outcomes. Clearing a universe also clears its descendants.')
	host.replaceChildren(toolbar, context, layout, guidance, status)
	let state: ExplorerState = { universes: [], approved: new Set(), network: '', disabled: true }
	let tree = indexUniverseTree([])
	const expanded = new Set<string>()
	let branchRoot: string | undefined
	let focused: string | undefined
	let limit = PAGE_SIZE
	let pending = false
	let signature = ''
	let networkRevision = 0
	const scrollOnMobile = (target: HTMLElement) => {
		if (document.defaultView?.matchMedia('(max-width: 700px)').matches !== true) return
		const headerHeight = document.querySelector('.operator-shell')?.getBoundingClientRect().height ?? 0
		const navHeight = document.querySelector('.section-nav')?.getBoundingClientRect().height ?? 0
		target.style.scrollMarginTop = `${headerHeight + navHeight + 16}px`
		target.scrollIntoView({ block: 'start' })
	}
	const inspect = (id: string) => {
		focused = id
		render()
		scrollOnMobile(detail)
	}
	const reveal = (id: string, showChildren = false) => {
		search.value = ''
		filter.value = 'all'
		for (const ancestor of universeLineage(tree, id)) expanded.add(ancestor.id)
		focused = id
		branchRoot = undefined
		// Keep distant lineage navigation bounded without filtering out children.
		if (showChildren || !visibleUniverseRows(tree, expanded, state.approved, '', false, limit).rows.some(row => row.node.id === id)) {
			branchRoot = id
			limit = PAGE_SIZE
		}
		render()
		for (const control of host.querySelectorAll<HTMLElement>('[data-universe-focus]')) if (control.dataset['universeFocus'] === `inspect:${id}`) control.focus({ preventScroll: true })
		scrollOnMobile(browser)
	}
	async function changeApproval(id: string, checked: boolean) {
		if (pending || state.disabled) return
		const revision = networkRevision
		const next = universeApprovalSelection(tree, state.approved, id, checked)
		pending = true
		status.textContent = 'Saving selection…'
		status.dataset['error'] = 'false'
		render()
		try {
			await options.onChange(next)
			if (revision !== networkRevision) return
			state = { ...state, approved: next }
			status.textContent = options.savedMessage
		} catch (error) {
			if (revision !== networkRevision) return
			status.textContent = error instanceof Error ? error.message : 'Could not save universe approval. Retry this selection.'
			status.dataset['error'] = 'true'
		} finally {
			pending = false
			render()
		}
	}
	function renderDetails() {
		detail.replaceChildren()
		const node = focused === undefined ? undefined : tree.byId.get(focused)
		if (node === undefined) {
			detail.append(make('p', 'ue-empty', 'Select a universe to inspect its origin and REP token.'))
			return
		}
		detail.append(button('ue-back-link', '← Back to tree', () => scrollOnMobile(browser)))
		const lineage = universeLineage(tree, node.id)
		detail.append(make('span', 'ue-eyebrow', 'Universe lineage'), make('h3', 'ue-detail-title', universeLabel(node)))
		const path = make('p', 'ue-lineage', lineage.map(universeLabel).join(' › '))
		detail.append(path)
		const badge = make('span', 'ue-approval-badge', state.approved.has(node.id) ? 'Approved' : 'Not approved')
		badge.dataset['approved'] = String(state.approved.has(node.id))
		detail.append(badge)
		const metadata = make('dl', 'ue-metadata')
		for (const [label, value] of [
			['Universe ID', node.id],
			['REP token', node.repToken ?? 'Not available'],
			['Fork question', node.forkQuestionId],
		]) {
			if (value === undefined || label === undefined) continue
			metadata.append(make('dt', '', label), make('dd', '', value))
		}
		detail.append(metadata)
		if (node.summary !== undefined) detail.append(make('p', 'ue-activity', node.summary))
		if (node.parentId !== undefined) {
			const parent = tree.byId.get(node.parentId)
			if (parent !== undefined) detail.append(button('ue-parent-link', `← View parent · ${universeLabel(parent)}`, () => reveal(parent.id)))
		}
		const children = tree.children.get(node.id) ?? []
		if (children.length > 0)
			detail.append(
				button('ue-parent-link', `View ${children.length.toLocaleString()} child universes →`, () => {
					expanded.add(node.id)
					reveal(node.id, true)
				}),
			)
	}
	function render() {
		const active = document.activeElement
		const focusKey = active?.getAttribute('data-universe-focus')
		const scrollTop = list.scrollTop
		const branch = branchRoot === undefined ? undefined : tree.byId.get(branchRoot)
		const visible = visibleUniverseRows(branch === undefined ? tree : { ...tree, roots: [branch] }, expanded, state.approved, search.value, filter.value === 'approved', limit)
		count.textContent = `${state.network} · ${tree.byId.size.toLocaleString()} universes · ${state.approved.size.toLocaleString()} approved`
		list.replaceChildren()
		for (const { node, depth } of visible.rows) {
			const row = make('li', 'ue-row')
			row.style.setProperty('--ue-depth', Math.min(depth, 5).toString())
			row.dataset['root'] = String(depth === 0)
			row.dataset['selected'] = String(focused === node.id)
			row.dataset['approved'] = String(state.approved.has(node.id))
			const children = tree.children.get(node.id) ?? []
			const toggle = button('ue-expand', expanded.has(node.id) ? '⌄' : '›', () => {
				if (expanded.has(node.id)) expanded.delete(node.id)
				else expanded.add(node.id)
				render()
			})
			toggle.hidden = children.length === 0 || visible.filtering
			toggle.setAttribute('aria-label', `${expanded.has(node.id) ? 'Collapse' : 'Expand'} children of universe ${node.id}`)
			toggle.setAttribute('aria-expanded', String(expanded.has(node.id)))
			toggle.dataset['universeFocus'] = `expand:${node.id}`
			const inspectButton = button('ue-node', '', () => inspect(node.id))
			inspectButton.dataset['universeFocus'] = `inspect:${node.id}`
			inspectButton.setAttribute('aria-label', `Inspect ${universeLabel(node)}, universe ${node.id}`)
			inspectButton.append(make('span', 'ue-node-title', universeLabel(node)))
			let description = `#${compact(node.id)}`
			if (visible.filtering || depth > 5) description = universeLineage(tree, node.id).map(universeLabel).join(' › ')
			inspectButton.append(make('span', 'ue-node-id', description))
			if (children.length > 0) inspectButton.append(make('span', 'ue-children-count', `${children.length.toLocaleString()} children`))
			const approval = make('input', 'ue-approve')
			approval.type = 'checkbox'
			approval.value = node.id
			approval.checked = state.approved.has(node.id)
			approval.disabled = state.disabled || pending
			approval.dataset['universeFocus'] = `approve:${node.id}`
			approval.setAttribute('aria-label', `Approve path through ${universeLabel(node)}, universe ${node.id}`)
			approval.addEventListener('change', () => {
				void changeApproval(node.id, approval.checked)
			})
			const approvalTarget = make('label', 'ue-approval-target')
			approvalTarget.append(approval)
			row.append(toggle, inspectButton, approvalTarget)
			list.append(row)
		}
		empty.hidden = visible.total !== 0
		empty.textContent = tree.byId.size === 0 ? 'Universe discovery has not completed.' : 'No universes match this view.'
		more.hidden = visible.rows.length >= visible.total
		more.textContent = `Show ${Math.min(PAGE_SIZE, visible.total - visible.rows.length).toLocaleString()} more · ${visible.rows.length.toLocaleString()} of ${visible.total.toLocaleString()}`
		collapse.textContent = branch === undefined ? 'Collapse branches' : 'Show whole tree'
		collapse.disabled = (branch === undefined && expanded.size === 0) || visible.filtering
		search.disabled = state.disabled
		filter.disabled = state.disabled
		renderDetails()
		if (focusKey !== null && focusKey !== undefined) {
			for (const control of host.querySelectorAll<HTMLElement>('[data-universe-focus]')) if (control.dataset['universeFocus'] === focusKey) control.focus({ preventScroll: true })
		}
		list.scrollTop = scrollTop
	}
	for (const input of [search, filter])
		input.addEventListener('input', () => {
			limit = PAGE_SIZE
			render()
		})
	return {
		update(next: ExplorerState) {
			const nextSignature = JSON.stringify([next.universes, [...next.approved], next.network, next.disabled])
			if (nextSignature === signature) return
			signature = nextSignature
			const networkChanged = next.network !== state.network
			if (networkChanged) {
				networkRevision += 1
				expanded.clear()
				branchRoot = undefined
				focused = undefined
				search.value = ''
				filter.value = 'all'
				limit = PAGE_SIZE
				status.textContent = ''
			}
			state = pending && !networkChanged ? { ...next, approved: state.approved } : next
			tree = indexUniverseTree(next.universes)
			if (focused === undefined || !tree.byId.has(focused)) {
				focused = tree.roots[0]?.id
				for (const root of tree.roots) expanded.add(root.id)
				for (const id of next.approved) {
					let node = tree.byId.get(id)
					while (node !== undefined && !expanded.has(node.id)) {
						expanded.add(node.id)
						node = node.parentId === undefined ? undefined : tree.byId.get(node.parentId)
					}
				}
			}
			render()
		},
	}
}
