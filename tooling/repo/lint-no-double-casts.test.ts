import { expect, test } from 'bun:test'
import { findDoubleCasts, inspectDoubleCasts, isDoubleCastCheckedSource, sanctionedDoubleCastFiles } from './lint-no-double-casts.mts'

const file = 'ui/zoltar/ts/tests/protocol/example.test.ts'

test('tracked TypeScript sources are checked except generated output and the sanctioned helper', () => {
	expect(isDoubleCastCheckedSource(file)).toBe(true)
	expect(isDoubleCastCheckedSource('bots/chaos/src/runtime/operator.ts')).toBe(true)
	expect(isDoubleCastCheckedSource('tooling/repo/check-changed.mts')).toBe(true)
	expect(isDoubleCastCheckedSource('ui/zoltar/js/protocol/example.ts')).toBe(false)
	expect(isDoubleCastCheckedSource('bots/shared/src/contracts/abi.generated.ts')).toBe(false)
	expect(isDoubleCastCheckedSource('solidity/ts/types/index.d.ts')).toBe(false)
	expect(isDoubleCastCheckedSource('docs/runtime/docsShell.js')).toBe(false)
	for (const sanctioned of sanctionedDoubleCastFiles) expect(isDoubleCastCheckedSource(sanctioned)).toBe(false)
})

test('casts laundered through unknown or any are reported with their position', () => {
	const source = ['const first = {} as unknown as Client', 'const second = (value as any) as Client', 'const third = ({} as unknown) as Client', ''].join('\n')
	expect(findDoubleCasts(file, source)).toEqual([
		{ column: 15, file, line: 1 },
		{ column: 16, file, line: 2 },
		{ column: 15, file, line: 3 },
	])
})

test('single casts and const assertions are accepted', () => {
	const source = ['const first = value as Client', 'const second = value as unknown', "const third = ['a'] as const", 'const fourth = (value as Client).name as string', ''].join('\n')
	expect(findDoubleCasts(file, source)).toEqual([])
})

test('TSX sources are parsed as TSX', () => {
	const source = ['export const Example = () => <p>{(value as unknown as string).length}</p>', ''].join('\n')
	expect(findDoubleCasts('ui/trading/ts/features/Example.tsx', source)).toEqual([{ column: 35, file: 'ui/trading/ts/features/Example.tsx', line: 1 }])
})

test('findings are ordered and limited to checked sources', () => {
	const sources = new Map([
		['ui/zoltar/ts/b.ts', 'const value = {} as unknown as Client\n'],
		[[...sanctionedDoubleCastFiles][0] ?? '', 'const value = {} as unknown as Client\n'],
		['bots/shared/src/a.ts', 'const value = {} as any as Client\n'],
	])
	expect(inspectDoubleCasts(sources).map(finding => finding.file)).toEqual(['bots/shared/src/a.ts', 'ui/zoltar/ts/b.ts'])
})
