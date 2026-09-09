import { expect, test } from 'bun:test'
import { indexUniverseTree, universeApprovalSelection, universeLineage, visibleUniverseRows, type UniverseNode } from '../src/dashboard/universe-tree.ts'

const nodes = [{ id: '0' }, { id: '1', parentId: '0', outcomeIndex: '1' }, { id: '2', parentId: '0', outcomeIndex: '2' }, { id: '3', parentId: '1', outcomeIndex: '1' }, { id: '4', parentId: '2', outcomeIndex: '1', repToken: '0xabcdef' }]
const tree = indexUniverseTree(nodes)

test('keeps a clear ancestor chain while branches are collapsed', () => {
	expect(visibleUniverseRows(tree, new Set(['0']), new Set(), '', false, 60).rows.map(row => [row.node.id, row.depth])).toEqual([
		['0', 0],
		['1', 1],
		['2', 1],
	])
	expect(universeLineage(tree, '4').map(node => node.id)).toEqual(['0', '2', '4'])
	expect(visibleUniverseRows(tree, new Set(), new Set(), '0xabc', false, 60).rows.map(row => row.node.id)).toEqual(['4'])
	expect(visibleUniverseRows(tree, new Set(), new Set(['3']), '', true, 60).rows.map(row => row.node.id)).toEqual(['3'])
})

test('changing a path clears competing descendants and clearing an ancestor clears its subtree', () => {
	expect([...universeApprovalSelection(tree, new Set(['0', '1', '3']), '4', true)]).toEqual(['0', '2', '4'])
	expect([...universeApprovalSelection(tree, new Set(['0', '2', '4']), '2', false)]).toEqual(['0'])
})

test('bounds the rendered page for a wide registry and handles deep ancestry without recursion', () => {
	const wide = indexUniverseTree([{ id: '0' }, ...Array.from({ length: 10000 }, (_, i) => ({ id: String(i + 1), parentId: '0' }))])
	const first = visibleUniverseRows(wide, new Set(['0']), new Set(), '', false, 60)
	expect(first.rows).toHaveLength(60)
	expect(first.total).toBe(10001)
	expect(visibleUniverseRows(wide, new Set(['0']), new Set(), '', false, 120).rows).toHaveLength(120)
	const deep: UniverseNode[] = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), parentId: i === 0 ? undefined : String(i - 1) }))
	expect(universeLineage(indexUniverseTree(deep), '9999')).toHaveLength(10000)
})

test('terminates on malformed cyclic ancestry', () => {
	const cyclic = indexUniverseTree([
		{ id: '1', parentId: '2' },
		{ id: '2', parentId: '1' },
	])
	expect(universeLineage(cyclic, '1')).toHaveLength(2)
	expect([...universeApprovalSelection(cyclic, new Set(['1', '2']), '1', false)]).toEqual([])
})
