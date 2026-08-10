import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import parser from '@solidity-parser/parser'

type SourceRange = {
	end: number
	start: number
}

const scriptDirectory = path.dirname(url.fileURLToPath(import.meta.url))
const projectRoot = path.join(scriptDirectory, '..')
const contractsRoot = path.join(projectRoot, 'solidity', 'contracts')
const excludedProjectPaths = new Set(['solidity/contracts/peripherals/Multicall3.sol', 'solidity/contracts/peripherals/WETH9.sol', 'solidity/contracts/peripherals/openOracle/OpenOracle.sol'])

function projectPath(filePath: string): string {
	return path.relative(projectRoot, filePath).replaceAll('\\', '/')
}

function isExcluded(filePath: string): boolean {
	return excludedProjectPaths.has(projectPath(filePath))
}

async function collectSolidityFiles(directory: string, files: string[] = []): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true })
	for (const entry of entries) {
		const filePath = path.join(directory, entry.name)
		if (entry.isDirectory()) {
			await collectSolidityFiles(filePath, files)
			continue
		}
		if (entry.isFile() && entry.name.endsWith('.sol') && !isExcluded(filePath)) files.push(filePath)
	}
	return files
}

function requiredRange(node: { range?: [number, number]; type: string }): SourceRange {
	if (node.range === undefined) throw new Error(`${node.type} is missing its source range`)
	return { end: node.range[1] + 1, start: node.range[0] }
}

function skipQuotedValue(source: string, start: number, end: number): number {
	const quote = source[start]
	let index = start + 1
	while (index < end) {
		if (source[index] === '\\') {
			index += 2
			continue
		}
		if (source[index] === quote) return index + 1
		index += 1
	}
	return end
}

function skipComment(source: string, start: number, end: number): number {
	if (source[start + 1] === '/') {
		const lineEnd = source.indexOf('\n', start + 2)
		return lineEnd === -1 || lineEnd >= end ? end : lineEnd + 1
	}
	const blockEnd = source.indexOf('*/', start + 2)
	return blockEnd === -1 || blockEnd + 2 >= end ? end : blockEnd + 2
}

function functionParameterRange(source: string, start: number, end: number): SourceRange {
	let openingParenthesis = -1
	let depth = 0
	let index = start
	while (index < end) {
		const character = source[index]
		if (character === '"' || character === "'") {
			index = skipQuotedValue(source, index, end)
			continue
		}
		if (character === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
			index = skipComment(source, index, end)
			continue
		}
		if (character === '(') {
			if (openingParenthesis === -1) openingParenthesis = index
			depth += 1
		} else if (character === ')' && openingParenthesis !== -1) {
			depth -= 1
			if (depth === 0) return { end: index + 1, start: openingParenthesis }
		}
		index += 1
	}
	throw new Error(`Unable to find function parameter boundaries at source offset ${start.toString()}`)
}

function mergeRanges(ranges: SourceRange[]): SourceRange[] {
	const sortedRanges = ranges.toSorted((left, right) => left.start - right.start || right.end - left.end)
	const mergedRanges: SourceRange[] = []
	for (const range of sortedRanges) {
		const previous = mergedRanges[mergedRanges.length - 1]
		if (previous === undefined || range.start >= previous.end) {
			mergedRanges.push({ ...range })
			continue
		}
		if (range.end > previous.end) previous.end = range.end
	}
	return mergedRanges
}

function needsSpace(previous: string | undefined, next: string): boolean {
	if (previous === undefined) return false
	if ('([{.'.includes(previous)) return false
	if (')]}.,;'.includes(next)) return false
	return true
}

function appendPendingSpace(output: string[], pendingSpace: boolean, next: string): void {
	if (!pendingSpace) return
	const previousChunk = output[output.length - 1]
	const previous = previousChunk?.at(-1)
	if (needsSpace(previous, next)) output.push(' ')
}

function collapseToOneLine(source: string): string {
	const output: string[] = []
	let pendingSpace = false
	let index = 0
	while (index < source.length) {
		const character = source[index]
		if (character === undefined) throw new Error(`Missing source character at offset ${index.toString()}`)
		if (/\s/.test(character ?? '')) {
			pendingSpace = true
			index += 1
			continue
		}
		if (character === '"' || character === "'") {
			const nextIndex = skipQuotedValue(source, index, source.length)
			appendPendingSpace(output, pendingSpace, character)
			output.push(source.slice(index, nextIndex))
			pendingSpace = false
			index = nextIndex
			continue
		}
		if (character === '/' && source[index + 1] === '/') {
			const lineEnd = source.indexOf('\n', index + 2)
			const nextIndex = lineEnd === -1 ? source.length : lineEnd + 1
			appendPendingSpace(output, pendingSpace, '/')
			const comment = source
				.slice(index + 2, lineEnd === -1 ? source.length : lineEnd)
				.trim()
				.replaceAll('*/', '* /')
			output.push(`/* ${comment} */`)
			pendingSpace = true
			index = nextIndex
			continue
		}
		if (character === '/' && source[index + 1] === '*') {
			const nextIndex = skipComment(source, index, source.length)
			appendPendingSpace(output, pendingSpace, '/')
			const comment = source
				.slice(index + 2, nextIndex - 2)
				.trim()
				.replace(/\s+/g, ' ')
			output.push(`/* ${comment} */`)
			pendingSpace = true
			index = nextIndex
			continue
		}
		appendPendingSpace(output, pendingSpace, character)
		output.push(character)
		pendingSpace = false
		index += 1
	}
	return output.join('').trim()
}

export function enforceSolidityOneLineForms(source: string): string {
	const ast = parser.parse(source, { loc: true, range: true })
	const ranges: SourceRange[] = []
	parser.visit(ast, {
		EmitStatement(node) {
			ranges.push(requiredRange(node))
		},
		EventDefinition(node) {
			ranges.push(requiredRange(node))
		},
		FunctionCall(node) {
			ranges.push(requiredRange(node))
		},
		FunctionDefinition(node) {
			const nodeRange = requiredRange(node)
			const headerEnd = node.body?.range?.[0] ?? nodeRange.end
			ranges.push(functionParameterRange(source, nodeRange.start, headerEnd))
		},
	})
	let result = source
	for (const range of mergeRanges(ranges).toReversed()) {
		result = `${result.slice(0, range.start)}${collapseToOneLine(result.slice(range.start, range.end))}${result.slice(range.end)}`
	}
	return result
}

function canonicalSoliditySource(prettierSource: string): string {
	const oneLineSource = enforceSolidityOneLineForms(prettierSource)
	parser.parse(oneLineSource, { loc: true, range: true })
	return oneLineSource
}

function runPrettier(filePaths: string[]): void {
	execFileSync('bunx', ['prettier', '--config', path.join(projectRoot, '.prettierrc.json'), '--write', ...filePaths], {
		cwd: projectRoot,
		encoding: 'utf8',
		stdio: 'pipe',
	})
}

function canonicalFileSource(filePath: string, source: string): string {
	const prettierSource = execFileSync('bunx', ['prettier', '--config', path.join(projectRoot, '.prettierrc.json'), '--stdin-filepath', filePath], {
		cwd: projectRoot,
		encoding: 'utf8',
		input: source,
		stdio: ['pipe', 'pipe', 'pipe'],
	})
	return canonicalSoliditySource(prettierSource)
}

export async function checkSolidityFiles(files: string[]): Promise<string[]> {
	const changedFiles: string[] = []
	for (const filePath of files) {
		const source = await fs.readFile(filePath, 'utf8')
		if (source !== canonicalFileSource(filePath, source)) changedFiles.push(projectPath(filePath))
	}
	return changedFiles.toSorted()
}

export async function writeSolidityFiles(files: string[]): Promise<string[]> {
	const originalSources = new Map<string, string>()
	for (const filePath of files) originalSources.set(filePath, await fs.readFile(filePath, 'utf8'))
	runPrettier(files)
	const changedFiles: string[] = []
	for (const filePath of files) {
		const prettierSource = await fs.readFile(filePath, 'utf8')
		const canonicalSource = canonicalSoliditySource(prettierSource)
		if (canonicalSource !== prettierSource) await fs.writeFile(filePath, canonicalSource)
		if (canonicalSource !== originalSources.get(filePath)) changedFiles.push(projectPath(filePath))
	}
	return changedFiles
}

async function main(): Promise<void> {
	const mode = process.argv[2]
	if (mode !== '--check' && mode !== '--write') throw new Error('Usage: bun scripts/format-solidity-one-line.mts --check|--write')
	const files = await collectSolidityFiles(contractsRoot)
	const changedFiles = mode === '--write' ? await writeSolidityFiles(files) : await checkSolidityFiles(files)
	if (mode === '--write') {
		console.log(`Formatted ${changedFiles.length.toString()} Solidity file(s) with one-line declarations and calls.`)
		return
	}
	if (changedFiles.length === 0) {
		console.log(`Checked ${files.length.toString()} Solidity file(s); all Prettier formatting, declarations, and calls are canonical.`)
		return
	}
	console.error('Solidity formatting differs in:')
	for (const filePath of changedFiles) console.error(`- ${filePath}`)
	console.error('Run `bun run format:solidity` to fix these files.')
	process.exitCode = 1
}

if (import.meta.main) await main()
