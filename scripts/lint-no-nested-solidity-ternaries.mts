import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

type TernaryFrame = {
	file: string
	line: number
	column: number
	parenDepth: number
	bracketDepth: number
	braceDepth: number
	hasColon: boolean
}

type NestedTernaryFinding = {
	file: string
	line: number
	column: number
	parentLine: number
	parentColumn: number
}

const repositoryRoot = path.dirname(url.fileURLToPath(import.meta.url))
const projectRoot = path.join(repositoryRoot, '..')
const contractsRoot = path.join(projectRoot, 'solidity', 'contracts')
const ignoredFiles = new Set(['solidity/contracts/peripherals/Multicall3.sol', 'solidity/contracts/peripherals/WETH9.sol'])
const ignoredPathPrefixes = ['solidity/contracts/peripherals/openOracle']

function toProjectPath(filePath: string): string {
	return path.relative(projectRoot, filePath).replaceAll('\\', '/')
}

function shouldIgnore(filePath: string): boolean {
	const relativePath = toProjectPath(filePath)
	if (ignoredFiles.has(relativePath)) return true
	return ignoredPathPrefixes.some(prefix => relativePath === prefix || relativePath.startsWith(`${prefix}/`))
}

async function collectSolidityFiles(directory: string, files: string[] = []): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true })
	for (const entry of entries) {
		const fullPath = path.join(directory, entry.name)
		if (entry.isDirectory()) {
			if (!shouldIgnore(fullPath)) await collectSolidityFiles(fullPath, files)
			continue
		}
		if (entry.isFile() && entry.name.endsWith('.sol') && !shouldIgnore(fullPath)) files.push(fullPath)
	}
	return files
}

function atSameDepth(frame: TernaryFrame, parenDepth: number, bracketDepth: number, braceDepth: number): boolean {
	return frame.parenDepth === parenDepth && frame.bracketDepth === bracketDepth && frame.braceDepth === braceDepth
}

function discardCompletedTernariesAtBoundary(frames: TernaryFrame[], parenDepth: number, bracketDepth: number, braceDepth: number): void {
	while (frames.length > 0) {
		const frame = frames[frames.length - 1]
		if (frame === undefined || !frame.hasColon) return
		if (atSameDepth(frame, parenDepth, bracketDepth, braceDepth)) {
			frames.pop()
			continue
		}
		return
	}
}

function discardCompletedTernariesClosedByDepth(frames: TernaryFrame[], parenDepth: number, bracketDepth: number, braceDepth: number): void {
	while (frames.length > 0) {
		const frame = frames[frames.length - 1]
		if (frame === undefined || !frame.hasColon) return
		if (frame.parenDepth > parenDepth || frame.bracketDepth > bracketDepth || frame.braceDepth > braceDepth) {
			frames.pop()
			continue
		}
		return
	}
}

function findTernaryColonFrame(frames: TernaryFrame[], parenDepth: number, bracketDepth: number, braceDepth: number): TernaryFrame | undefined {
	for (let index = frames.length - 1; index >= 0; index -= 1) {
		const frame = frames[index]
		if (frame === undefined) continue
		if (!frame.hasColon && atSameDepth(frame, parenDepth, bracketDepth, braceDepth)) return frame
	}
	return undefined
}

function scanSolidityFile(filePath: string, source: string): NestedTernaryFinding[] {
	const findings: NestedTernaryFinding[] = []
	const frames: TernaryFrame[] = []
	let line = 1
	let column = 1
	let parenDepth = 0
	let bracketDepth = 0
	let braceDepth = 0
	let index = 0

	function advanceCharacter(): void {
		const character = source[index]
		index += 1
		if (character === '\n') {
			line += 1
			column = 1
		} else {
			column += 1
		}
	}

	function skipLineComment(): void {
		while (index < source.length && source[index] !== '\n') advanceCharacter()
	}

	function skipBlockComment(): void {
		advanceCharacter()
		advanceCharacter()
		while (index < source.length) {
			if (source[index] === '*' && source[index + 1] === '/') {
				advanceCharacter()
				advanceCharacter()
				return
			}
			advanceCharacter()
		}
	}

	function skipQuotedString(quote: string): void {
		advanceCharacter()
		while (index < source.length) {
			const character = source[index]
			if (character === '\\') {
				advanceCharacter()
				if (index < source.length) advanceCharacter()
				continue
			}
			advanceCharacter()
			if (character === quote) return
		}
	}

	while (index < source.length) {
		const character = source[index]
		const nextCharacter = source[index + 1]
		if (character === '/' && nextCharacter === '/') {
			skipLineComment()
			continue
		}
		if (character === '/' && nextCharacter === '*') {
			skipBlockComment()
			continue
		}
		if (character === '"' || character === "'") {
			skipQuotedString(character)
			continue
		}
		if (character === '(') {
			parenDepth += 1
			advanceCharacter()
			continue
		}
		if (character === '[') {
			bracketDepth += 1
			advanceCharacter()
			continue
		}
		if (character === '{') {
			braceDepth += 1
			advanceCharacter()
			continue
		}
		if (character === ')') {
			parenDepth = Math.max(0, parenDepth - 1)
			discardCompletedTernariesClosedByDepth(frames, parenDepth, bracketDepth, braceDepth)
			advanceCharacter()
			continue
		}
		if (character === ']') {
			bracketDepth = Math.max(0, bracketDepth - 1)
			discardCompletedTernariesClosedByDepth(frames, parenDepth, bracketDepth, braceDepth)
			advanceCharacter()
			continue
		}
		if (character === '}') {
			braceDepth = Math.max(0, braceDepth - 1)
			discardCompletedTernariesClosedByDepth(frames, parenDepth, bracketDepth, braceDepth)
			advanceCharacter()
			continue
		}
		if (character === ';') {
			frames.length = 0
			advanceCharacter()
			continue
		}
		if (character === ',') {
			discardCompletedTernariesAtBoundary(frames, parenDepth, bracketDepth, braceDepth)
			advanceCharacter()
			continue
		}
		if (character === ':') {
			const frame = findTernaryColonFrame(frames, parenDepth, bracketDepth, braceDepth)
			if (frame !== undefined) frame.hasColon = true
			advanceCharacter()
			continue
		}
		if (character === '?') {
			const parentFrame = frames[frames.length - 1]
			if (parentFrame !== undefined) {
				findings.push({
					file: filePath,
					line,
					column,
					parentLine: parentFrame.line,
					parentColumn: parentFrame.column,
				})
			}
			frames.push({
				file: filePath,
				line,
				column,
				parenDepth,
				bracketDepth,
				braceDepth,
				hasColon: false,
			})
			advanceCharacter()
			continue
		}
		advanceCharacter()
	}
	return findings
}

async function main(): Promise<void> {
	const files = await collectSolidityFiles(contractsRoot)
	const findings: NestedTernaryFinding[] = []
	for (const filePath of files) {
		const source = await fs.readFile(filePath, 'utf8')
		findings.push(...scanSolidityFile(filePath, source))
	}
	if (findings.length === 0) return

	console.log('Nested ternary expressions are not allowed in owned Solidity. Use if/else blocks or named helper functions instead.')
	for (const finding of findings) {
		console.log(`${toProjectPath(finding.file)}:${finding.line}:${finding.column} - nested ternary; parent ternary starts at ${finding.parentLine}:${finding.parentColumn}`)
	}
	console.log(`\nFound ${findings.length} nested Solidity ternary expression(s).`)
	process.exitCode = 1
}

await main()
