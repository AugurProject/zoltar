import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import * as path from 'node:path'

const tokensPath = 'ui/coreShared/css/tokens.css'
const stylesheetRoots = ['ui/coreShared/css', 'ui/statoblastShared/css', 'ui/zoltarShared/css', 'ui/trading/css']
const breakpointTokens = ['--breakpoint-compact', '--breakpoint-medium', '--breakpoint-wide'] as const

// Header and account-menu media queries that the pending app chrome rewrite replaces; they keep their old values
// until that rewrite lands so the two changes do not edit the same rules. Remove entries as the rules disappear.
const pendingChromeRewriteQueries: ReadonlyArray<string> = [
	'ui/coreShared/css/base.css (max-width: 26rem)',
	'ui/coreShared/css/controls-and-responsive.css (max-width: 22.4375rem)',
	'ui/coreShared/css/controls-and-responsive.css (max-width: 42rem)',
	'ui/coreShared/css/controls-and-responsive.css (max-width: 56rem)',
	'ui/coreShared/css/controls-and-responsive.css (min-width: 40.0625rem)',
	'ui/coreShared/css/controls-and-responsive.css (min-width: 50.0625rem) and (max-width: 75rem)',
	'ui/coreShared/css/protocol-apps.css (max-width: 48rem)',
]

function readBreakpointValues() {
	const tokens = readFileSync(tokensPath, 'utf8')
	return breakpointTokens.map(name => {
		const value = tokens.match(new RegExp(`${name}: ([^;]+);`))?.[1]
		if (value === undefined) throw new Error(`Missing ${name} in ${tokensPath}`)
		return value
	})
}

function listStylesheets(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
		const entryPath = path.join(root, entry.name)
		if (entry.isDirectory()) return listStylesheets(entryPath)
		return entry.name.endsWith('.css') ? [entryPath] : []
	})
}

function listMediaQueries() {
	return stylesheetRoots.flatMap(listStylesheets).flatMap(file => [...readFileSync(file, 'utf8').matchAll(/@media ([^{]+)\{/g)].map(match => ({ file, query: (match[1] ?? '').trim() })))
}

test('breakpoint tokens define three rem values', () => {
	const values = readBreakpointValues()
	expect(new Set(values).size).toBe(3)
	for (const value of values) expect(value).toMatch(/^\d+(?:\.\d+)?rem$/)
})

test('every media query length uses a breakpoint token value', () => {
	const allowed = new Set(readBreakpointValues())
	const offenders = listMediaQueries()
		.filter(({ file, query }) => !pendingChromeRewriteQueries.includes(`${file} ${query}`))
		.filter(({ query }) => [...query.matchAll(/\d*\.?\d+[a-z]+/g)].some(length => !allowed.has(length[0])))
		.map(({ file, query }) => `${file} ${query}`)
	expect(offenders).toEqual([])
})

test('pending chrome media query exceptions still exist', () => {
	const present = new Set(listMediaQueries().map(({ file, query }) => `${file} ${query}`))
	expect(pendingChromeRewriteQueries.filter(entry => !present.has(entry))).toEqual([])
})
