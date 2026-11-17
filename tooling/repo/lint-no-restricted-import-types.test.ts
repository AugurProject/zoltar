import { expect, test } from 'bun:test'
import { findRestrictedImportTypes, isRestrictedImportCheckedSource } from './lint-no-restricted-import-types.mts'

const countFindings = (file: string, source: string) => findRestrictedImportTypes(file, source).length

test('inline import types of the restricted packages are reported with their position', () => {
	expect(findRestrictedImportTypes('fixture.ts', "export type Value = import('viem').Address")).toEqual([{ column: 28, file: 'fixture.ts', line: 1, text: "import('viem').Address" }])
	expect(countFindings('fixture.d.ts', "export type Module = typeof import('abitype/zod')")).toBe(1)
})

test('template-literal specifiers and subpath require calls are reported', () => {
	expect(countFindings('fixture.mjs', 'export const chains = import(`viem/chains`)')).toBe(1)
	expect(countFindings('fixture.cjs', 'module.exports = require(`viem`)')).toBe(1)
	expect(countFindings('fixture.cjs', "module.exports = require('viem/actions')")).toBe(1)
})

test('forms Biome already rejects and unrelated specifiers are left alone', () => {
	expect(countFindings('fixture.cjs', "module.exports = require('viem')")).toBe(0)
	expect(countFindings('fixture.ts', "export const value = import('viem')")).toBe(0)
	expect(countFindings('fixture.ts', "import { http } from 'viem'\nexport const value = http")).toBe(0)
	expect(countFindings('fixture.ts', "export type Local = import('./local.js').Value")).toBe(0)
	expect(countFindings('fixture.ts', "export type Other = import('viemish').Value")).toBe(0)
})

test('source files are checked except generated and vendored output', () => {
	expect(isRestrictedImportCheckedSource('ui/trading/ts/features/Example.tsx')).toBe(true)
	expect(isRestrictedImportCheckedSource('tooling/repo/check-changed.mts')).toBe(true)
	expect(isRestrictedImportCheckedSource('ui/trading/js/features/Example.js')).toBe(false)
	expect(isRestrictedImportCheckedSource('ui/trading/vendor/viem/index.js')).toBe(false)
	expect(isRestrictedImportCheckedSource('augurScan/public/app.js')).toBe(false)
	expect(isRestrictedImportCheckedSource('docs/documentation.html')).toBe(false)
})
