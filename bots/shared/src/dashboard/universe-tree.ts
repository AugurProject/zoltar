export type UniverseNode = {
	id: string
	parentId?: string | undefined
	outcomeIndex?: string | undefined
	repToken?: string | undefined
	summary?: string | undefined
	forkQuestionId?: string | undefined
}

export function indexUniverseTree(universes: readonly UniverseNode[]) {
	const byId = new Map(universes.map(universe => [universe.id, universe]))
	const children = new Map<string, UniverseNode[]>()
	const roots: UniverseNode[] = []
	for (const universe of universes) {
		if (universe.parentId === undefined || !byId.has(universe.parentId)) roots.push(universe)
		else {
			const siblings = children.get(universe.parentId) ?? []
			siblings.push(universe)
			children.set(universe.parentId, siblings)
		}
	}
	return { byId, children, roots }
}
export type UniverseTree = ReturnType<typeof indexUniverseTree>

export function universeLineage(tree: UniverseTree, id: string) {
	const path: UniverseNode[] = []
	const seen = new Set<string>()
	let node = tree.byId.get(id)
	while (node !== undefined && !seen.has(node.id)) {
		seen.add(node.id)
		path.push(node)
		node = node.parentId === undefined ? undefined : tree.byId.get(node.parentId)
	}
	return path.reverse()
}

export function universeLabel(node: UniverseNode) {
	return node.parentId === undefined ? 'Root universe' : `Outcome ${node.outcomeIndex ?? 'unknown'}`
}

export function universeApprovalSelection(tree: UniverseTree, approved: ReadonlySet<string>, id: string, checked: boolean) {
	const next = new Set(approved)
	const removeBranches = (roots: readonly string[]) => {
		const queue = [...roots]
		const seen = new Set<string>()
		for (let index = 0; index < queue.length; index += 1) {
			const current = queue[index]
			if (current === undefined || seen.has(current)) continue
			seen.add(current)
			next.delete(current)
			for (const child of tree.children.get(current) ?? []) queue.push(child.id)
		}
	}
	if (!checked) removeBranches([id])
	else {
		for (const node of universeLineage(tree, id)) {
			next.add(node.id)
			if (node.parentId !== undefined) removeBranches((tree.children.get(node.parentId) ?? []).filter(sibling => sibling.id !== node.id).map(sibling => sibling.id))
		}
	}
	return next
}

export function visibleUniverseRows(tree: UniverseTree, expanded: ReadonlySet<string>, approved: ReadonlySet<string>, query: string, approvedOnly: boolean, limit: number) {
	const search = query.trim().toLowerCase()
	const filtering = search !== '' || approvedOnly
	const rows: { node: UniverseNode; depth: number }[] = []
	let total = 0
	if (filtering) {
		for (const node of tree.byId.values()) {
			if (approvedOnly && !approved.has(node.id)) continue
			if (search !== '' && !`${node.id} ${node.repToken ?? ''} ${universeLabel(node)}`.toLowerCase().includes(search)) continue
			total += 1
			if (rows.length < limit) rows.push({ node, depth: 0 })
		}
	} else {
		const stack = tree.roots.map(node => ({ node, depth: 0 })).reverse()
		const seen = new Set<string>()
		while (stack.length > 0) {
			const row = stack.pop()
			if (row === undefined || seen.has(row.node.id)) continue
			seen.add(row.node.id)
			total += 1
			if (rows.length < limit) rows.push(row)
			if (!expanded.has(row.node.id)) continue
			const children = tree.children.get(row.node.id) ?? []
			for (let index = children.length - 1; index >= 0; index -= 1) {
				const node = children[index]
				if (node !== undefined) stack.push({ node, depth: row.depth + 1 })
			}
		}
	}
	return { rows, total, filtering }
}
