import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import * as path from 'node:path'

const tokensPath = 'ui/coreShared/css/tokens.css'
const stylesheetRoots = ['ui/coreShared/css', 'ui/statoblastShared/css', 'ui/zoltarShared/css', 'ui/trading/css']
const typescriptRoots = ['ui/coreShared/ts', 'ui/statoblastShared/ts', 'ui/zoltarShared/ts', 'ui/zoltar/ts', 'ui/statoblast/ts', 'ui/trading/ts']
const breakpointTokens = ['--breakpoint-compact', '--breakpoint-medium', '--breakpoint-wide'] as const

function readBreakpointValues() {
	const tokens = readFileSync(tokensPath, 'utf8')
	return breakpointTokens.map(name => {
		const value = tokens.match(new RegExp(`${name}: ([^;]+);`))?.[1]
		if (value === undefined) throw new Error(`Missing ${name} in ${tokensPath}`)
		return value
	})
}

function listFiles(root: string, matches: (name: string) => boolean): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
		const entryPath = path.join(root, entry.name)
		if (entry.isDirectory()) return entry.name === 'tests' || entry.name === 'generated' ? [] : listFiles(entryPath, matches)
		return matches(entry.name) ? [entryPath] : []
	})
}

function findOffendingLengths(conditions: ReadonlyArray<{ file: string; query: string }>) {
	const allowed = new Set(readBreakpointValues())
	return conditions.filter(({ query }) => [...query.matchAll(/\d*\.?\d+[a-z]+/g)].some(length => !allowed.has(length[0]))).map(({ file, query }) => `${file} ${query}`)
}

test('breakpoint tokens define three rem values', () => {
	const values = readBreakpointValues()
	expect(new Set(values).size).toBe(3)
	for (const value of values) expect(value).toMatch(/^\d+(?:\.\d+)?rem$/)
})

test('every stylesheet media query length uses a breakpoint token value', () => {
	const queries = stylesheetRoots.flatMap(root => listFiles(root, name => name.endsWith('.css'))).flatMap(file => [...readFileSync(file, 'utf8').matchAll(/@media ([^{]+)\{/g)].map(match => ({ file, query: (match[1] ?? '').trim() })))
	expect(queries.length).toBeGreaterThan(0)
	expect(findOffendingLengths(queries)).toEqual([])
})

test('every matchMedia query in application code uses a breakpoint token value', () => {
	const queries = typescriptRoots.flatMap(root => listFiles(root, name => /\.tsx?$/.test(name))).flatMap(file => [...readFileSync(file, 'utf8').matchAll(/'(\((?:max|min)-(?:width|height):[^']*)'/g)].map(match => ({ file, query: match[1] ?? '' })))
	expect(findOffendingLengths(queries)).toEqual([])
})
