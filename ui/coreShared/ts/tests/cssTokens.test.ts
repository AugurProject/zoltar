import { expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import * as path from 'node:path'

const tokensPath = 'ui/coreShared/css/tokens.css'
const stylesheetRoots = ['ui/coreShared/css', 'ui/statoblastShared/css', 'ui/zoltarShared/css', 'ui/trading/css']
const sharedStylesheetRoots = ['ui/coreShared/css/', 'ui/statoblastShared/css/', 'ui/zoltarShared/css/']
const isSharedStylesheet = (file: string) => sharedStylesheetRoots.some(root => file.startsWith(root))
const typescriptRoots = ['ui']

// Tokens that are declared for a consumer outside this scan or pinned by another test.
const tokenUsageAllowlist: ReadonlyMap<string, string> = new Map()

// Raw colour literals outside tokens.css that are intentionally retained. Keep this empty.
const rawColourAllowlist: readonly string[] = []

const rawColourPattern = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i

function listFiles(root: string, matches: (filePath: string) => boolean): string[] {
	const files: string[] = []
	for (const entry of readdirSync(root)) {
		const entryPath = path.join(root, entry)
		if (statSync(entryPath).isDirectory()) {
			if (entry === 'node_modules' || entry === 'js' || entry === 'vendor') continue
			files.push(...listFiles(entryPath, matches))
			continue
		}
		if (matches(entryPath)) files.push(entryPath)
	}
	return files
}

function readSources(): { stylesheets: Map<string, string>; typescript: Map<string, string> } {
	const stylesheets = new Map<string, string>()
	for (const root of stylesheetRoots) for (const file of listFiles(root, filePath => filePath.endsWith('.css'))) stylesheets.set(file, readFileSync(file, 'utf8'))
	const typescript = new Map<string, string>()
	for (const root of typescriptRoots) {
		for (const file of listFiles(root, filePath => /\/ts\/.*\.(?:ts|tsx)$/.test(filePath) && !filePath.endsWith('cssTokens.test.ts'))) typescript.set(file, readFileSync(file, 'utf8'))
	}
	return { stylesheets, typescript }
}

function declaredTokens(tokensSource: string): string[] {
	const names = new Set<string>()
	for (const declaration of tokensSource.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) {
		const name = declaration[1]
		if (name === undefined) throw new Error('Unable to read a token declaration')
		names.add(name)
	}
	return [...names]
}

function stripDeclarations(tokensSource: string): string {
	return tokensSource.replace(/^\s*--[a-z0-9-]+\s*:/gm, '')
}

test('every token declared in tokens.css is referenced by a stylesheet, TypeScript source, or another token', () => {
	const { stylesheets, typescript } = readSources()
	const tokensSource = stylesheets.get(tokensPath)
	if (tokensSource === undefined) throw new Error(`Missing ${tokensPath}`)
	const consumers = [...[...stylesheets.entries()].filter(([file]) => file !== tokensPath).map(([, source]) => source), ...typescript.values(), stripDeclarations(tokensSource)].join('\n')

	const unusedTokens = declaredTokens(tokensSource).filter(name => !tokenUsageAllowlist.has(name) && !new RegExp(`${name}(?![a-z0-9-])`).test(consumers))
	expect(unusedTokens).toEqual([])

	const staleAllowlist = [...tokenUsageAllowlist.keys()].filter(name => new RegExp(`var\\(${name}(?![a-z0-9-])`).test(consumers))
	expect(staleAllowlist).toEqual([])
})

test('raw colour literals only appear in tokens.css', () => {
	const { stylesheets } = readSources()
	const offenders: string[] = []
	for (const [file, source] of stylesheets) {
		if (file === tokensPath || !isSharedStylesheet(file)) continue
		source.split('\n').forEach((line, index) => {
			if (!rawColourPattern.test(line)) return
			const entry = `${file}:${index + 1}: ${line.trim()}`
			if (rawColourAllowlist.some(allowed => line.includes(allowed))) return
			offenders.push(entry)
		})
	}
	expect(offenders).toEqual([])
	expect(rawColourAllowlist).toEqual([])
})

test('the reduced-motion fallback is declared exactly once across the shared stylesheets', () => {
	const { stylesheets } = readSources()
	const occurrences = [...stylesheets.entries()].filter(([file]) => file.startsWith('ui/coreShared/css/')).flatMap(([file, source]) => [...source.matchAll(/@media \(prefers-reduced-motion: reduce\)/g)].map(() => file))
	expect(occurrences).toEqual(['ui/coreShared/css/visual-foundation.css'])
})

test('shared stylesheets resolve elevation, stacking, line height, and motion through tokens', () => {
	const { stylesheets } = readSources()
	const offenders: string[] = []
	for (const [file, source] of stylesheets) {
		if (file === tokensPath) continue
		// @font-face declares the vendored family name itself; every other font-family must go through a token.
		const sourceWithoutFontFaces = source.replace(/@font-face \{[^}]*\}/g, block => block.replace(/[^\n]/g, ''))
		sourceWithoutFontFaces.split('\n').forEach((line, index) => {
			const isRawDeclaration = /^\s*z-index:\s*-?\d/.test(line) || /^\s*line-height:\s*\d/.test(line) || /^\s*border-radius:\s*\d*\.?\d+(?:rem|px|%)/.test(line) || /\b\d+m?s ease/.test(line) || /^\s*font-family:.*(?:"|'|(?<![-\w])(?:monospace|sans-serif|serif)\b)/.test(line)
			if (isRawDeclaration) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
		})
	}
	expect(offenders).toEqual([])
})

test('every custom property referenced by a stylesheet is declared in tokens.css, another stylesheet, or set from TypeScript', () => {
	const { stylesheets, typescript } = readSources()
	const declared = new Set<string>()
	for (const source of stylesheets.values()) for (const declaration of source.matchAll(/(--[a-z0-9-]+)\s*:/g)) declared.add(declaration[1] ?? '')
	for (const source of typescript.values()) for (const declaration of source.matchAll(/['"`](--[a-z0-9-]+)['"`]/g)) declared.add(declaration[1] ?? '')
	const undeclared = new Set<string>()
	for (const source of stylesheets.values()) for (const reference of source.matchAll(/var\((--[a-z0-9-]+)/g)) if (!declared.has(reference[1] ?? '')) undeclared.add(reference[1] ?? '')
	expect([...undeclared]).toEqual([])
})

function readLightDarkRgb(tokensSource: string, name: string) {
	const match = new RegExp(`^\\s*${name}:\\s*light-dark\\(rgba\\((\\d+), (\\d+), (\\d+), 1\\), rgba\\((\\d+), (\\d+), (\\d+), 1\\)\\);`, 'm').exec(tokensSource)
	if (match === null) throw new Error(`Expected ${name} to be an opaque light-dark() pair`)
	const channels = match.slice(1).map(Number)
	return { light: channels.slice(0, 3), dark: channels.slice(3, 6) }
}

function relativeLuminance(channels: readonly number[]) {
	const [red = 0, green = 0, blue = 0] = channels.map(channel => {
		const value = channel / 255
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(foreground: readonly number[], background: readonly number[]) {
	const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((left, right) => right - left)
	return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)
}

test('focus outlines use the full product accent, which keeps 3:1 against the page in both themes', () => {
	const { stylesheets } = readSources()
	const tokensSource = stylesheets.get(tokensPath)
	if (tokensSource === undefined) throw new Error(`Missing ${tokensPath}`)
	expect(/^\s*--focus:\s*([^;]+);/m.exec(tokensSource)?.[1]).toBe('var(--accent)')
	const backgrounds = ['--bg', '--bg-deep', '--surface-section-opaque'].map(name => readLightDarkRgb(tokensSource, name))
	for (const product of ['zoltar', 'statoblast', 'trading']) {
		const accent = readLightDarkRgb(tokensSource, `--accent-${product}`)
		for (const background of backgrounds) {
			expect(contrastRatio(accent.light, background.light)).toBeGreaterThanOrEqual(3)
			expect(contrastRatio(accent.dark, background.dark)).toBeGreaterThanOrEqual(3)
		}
	}
	// A translucent mix fades the outline below 3:1, so focus rules draw their outline with a token instead.
	const translucentFocusOutlines: string[] = []
	for (const [file, source] of stylesheets) {
		for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			const [, selector = '', body = ''] = rule
			if (selector.includes(':focus') && /^\s*outline(?:-color)?:[^;]*color-mix\(/m.test(body)) translucentFocusOutlines.push(`${file}: ${selector.trim()}`)
		}
	}
	expect(translucentFocusOutlines).toEqual([])
})
