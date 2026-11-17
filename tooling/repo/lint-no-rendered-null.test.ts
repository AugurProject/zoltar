import { expect, test } from 'bun:test'
import { findRenderedNulls, inspectRenderedNulls, isComponentSource } from './lint-no-rendered-null.mts'

const component = 'ui/trading/ts/features/Example.tsx'

test('only UI component sources are inspected', () => {
	expect(isComponentSource(component)).toBe(true)
	expect(isComponentSource('ui/coreShared/ts/components/Example.tsx')).toBe(true)
	expect(isComponentSource('ui/trading/ts/tests/features/example.test.tsx')).toBe(false)
	expect(isComponentSource('ui/trading/ts/features/example.test.tsx')).toBe(false)
	expect(isComponentSource('ui/trading/ts/lib/routeState.ts')).toBe(false)
	expect(isComponentSource('ui/trading/js/features/Example.tsx')).toBe(false)
	expect(isComponentSource('bots/shared/src/dashboard/settings-markup.tsx')).toBe(false)
})

test('null values a component produces are reported with their position', () => {
	const source = ['export function Example({ visible }: { visible: boolean }) {', '\tif (!visible) return null', "\treturn <p>{visible ? 'shown' : null}</p>", '}', ''].join('\n')
	expect(findRenderedNulls(component, source)).toEqual([
		{ column: 23, file: component, line: 2 },
		{ column: 33, file: component, line: 3 },
	])
})

test('null read from or passed to an external API is accepted', () => {
	const source = [
		"import { useRef } from 'preact/hooks'",
		'export function Example({ storage }: { storage: Storage | null }) {',
		'\tconst element = useRef<HTMLElement | null>(null)',
		"\tconst stored = storage === null ? undefined : storage.getItem('key')",
		'\tif (stored !== null && element.current != null) return <p>{stored}</p>',
		'\treturn undefined',
		'}',
		'',
	].join('\n')
	expect(findRenderedNulls(component, source)).toEqual([])
})

test('null passed to a state setter or initial state is a produced value', () => {
	const source = ["import { useState } from 'preact/hooks'", 'export function Example() {', '\tconst [selected, setSelected] = useState<string | null>(null)', '\tsetSelected(null)', '\treturn <p>{JSON.stringify(selected, null, 2)}</p>', '}', ''].join('\n')
	expect(findRenderedNulls(component, source)).toEqual([
		{ column: 58, file: component, line: 3 },
		{ column: 14, file: component, line: 4 },
	])
})

test('a null nested inside a call argument is still a produced value', () => {
	const source = ['export const Example = () => <p>{[1].map(() => null)}</p>', ''].join('\n')
	expect(findRenderedNulls(component, source)).toEqual([{ column: 48, file: component, line: 1 }])
})

test('findings are ordered by file and position, skipping files outside the component scope', () => {
	const sources = new Map([
		['ui/trading/ts/features/Second.tsx', 'export const Second = () => null\n'],
		['ui/trading/ts/lib/notComponent.ts', 'export const value = null\n'],
		['ui/openoracle/ts/features/First.tsx', 'export const First = () => null\n'],
	])
	expect(inspectRenderedNulls(sources).map(finding => finding.file)).toEqual(['ui/openoracle/ts/features/First.tsx', 'ui/trading/ts/features/Second.tsx'])
})
