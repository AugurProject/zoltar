import { readFileSync } from 'node:fs'
import path from 'node:path'
import { listRepositoryFiles } from './git.mts'
import { repositoryRoot } from './root.mts'
import { productionSourceLineLimit, sourceSizeAllowances, type SourceSizeAllowance } from './source-size-policy.ts'

const productionRoots = /^(?:augurScan\/(?:src|public|browser|scripts)|bots\/[^/]+\/(?:src|scripts|contracts)|shared\/[^/]+\/ts|solidity\/(?:contracts|ts)|ui\/[^/]+\/(?:ts|build|scripts)|tooling|docs\/(?:charts|runtime))\//
const sourceExtension = /\.(?:[cm]?[jt]sx?|sol)$/
const excludedSegment = /\/(?:artifacts|dist|fixtures|js|node_modules|snapshots|tests?|vendor)\//
const excludedFile = /(?:\.(?:generated|spec|test)\.[cm]?[jt]sx?$|\/statoblast\/(?:Multicall3|WETH9)\.sol$|\/statoblast\/openOracle\/)/

export type SourceSizeFinding = {
	readonly detail?: string
	readonly file: string
	readonly lines: number
	readonly limit: number
	readonly kind: 'oversized' | 'allowance-exceeded' | 'stale-allowance' | 'missing-file' | 'invalid-allowance-reason' | 'invalid-allowance-limit' | 'invalid-allowance-path'
}

export const isProductionSource = (file: string): boolean => productionRoots.test(file) && sourceExtension.test(file) && !excludedSegment.test(file) && !excludedFile.test(file)

const countPhysicalLines = (source: string): number => {
	if (source === '') return 0
	const lines = source.split(/\r?\n/)
	return lines.at(-1) === '' ? lines.length - 1 : lines.length
}

// Counts Solidity lines that contain only comments, both NatSpec (`///` and `/**` blocks) and plain (`//` and `/*` blocks).
// A line that mixes code with a comment, or that is blank, is not comment-only.
export const countSolidityCommentOnlyLines = (source: string): number => {
	let commentOnlyLines = 0
	let lineHasCode = false
	let lineHasComment = false
	let state: 'code' | 'line-comment' | 'block-comment' | 'string' = 'code'
	let stringQuote = ''
	const finishLine = () => {
		if (lineHasComment && !lineHasCode) commentOnlyLines += 1
		lineHasCode = false
		lineHasComment = state === 'block-comment'
	}
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index]
		const next = source[index + 1]
		if (character === '\n') {
			if (state === 'line-comment') state = 'code'
			finishLine()
			continue
		}
		if (state === 'line-comment' || character === '\r') continue
		if (state === 'block-comment') {
			if (character === '*' && next === '/') {
				state = 'code'
				index += 1
			}
			continue
		}
		if (state === 'string') {
			if (character === '\\') index += 1
			else if (character === stringQuote) state = 'code'
			continue
		}
		if (character === '/' && (next === '/' || next === '*')) {
			state = next === '/' ? 'line-comment' : 'block-comment'
			lineHasComment = true
			index += 1
			continue
		}
		if (character === undefined || /\s/.test(character)) continue
		lineHasCode = true
		if (character === '"' || character === "'") {
			state = 'string'
			stringQuote = character
		}
	}
	if (source !== '' && !source.endsWith('\n')) finishLine()
	return commentOnlyLines
}

// Solidity comment-only lines are excluded so NatSpec and explanatory comments never push a contract over its size limit.
export const countSourceLines = (source: string, file: string): number => countPhysicalLines(source) - (file.endsWith('.sol') ? countSolidityCommentOnlyLines(source) : 0)

export function inspectSourceSizes(files: ReadonlyMap<string, string>, allowances: ReadonlyMap<string, SourceSizeAllowance> = sourceSizeAllowances, limit = productionSourceLineLimit): SourceSizeFinding[] {
	const findings: SourceSizeFinding[] = []
	const validAllowances = new Map<string, SourceSizeAllowance>()
	for (const [file, allowance] of allowances) {
		const lines = files.has(file) ? countSourceLines(files.get(file) ?? '', file) : 0
		let valid = true
		if (!isProductionSource(file)) {
			findings.push({ detail: 'allowances may only name production source files', file, lines, limit: allowance.maxLines, kind: 'invalid-allowance-path' })
			valid = false
		}
		if (!Number.isSafeInteger(allowance.maxLines) || allowance.maxLines <= limit) {
			findings.push({ detail: `the allowance ceiling must be an integer greater than the global ${limit.toString()} line limit`, file, lines, limit: allowance.maxLines, kind: 'invalid-allowance-limit' })
			valid = false
		}
		if (allowance.reason.trim() === '') {
			findings.push({ detail: 'every temporary allowance requires a nonblank explanation', file, lines, limit: allowance.maxLines, kind: 'invalid-allowance-reason' })
			valid = false
		}
		if (valid) validAllowances.set(file, allowance)
	}
	for (const [file, source] of files) {
		if (!isProductionSource(file)) continue
		const lines = countSourceLines(source, file)
		const allowance = validAllowances.get(file)
		if (allowance === undefined && lines > limit) findings.push({ file, lines, limit, kind: 'oversized' })
		else if (allowance !== undefined && lines > allowance.maxLines) findings.push({ file, lines, limit: allowance.maxLines, kind: 'allowance-exceeded' })
		else if (allowance !== undefined && lines < allowance.maxLines) findings.push({ file, lines, limit: lines <= limit ? limit : allowance.maxLines, kind: 'stale-allowance' })
	}
	for (const [file, allowance] of validAllowances) if (!files.has(file)) findings.push({ file, lines: 0, limit: allowance.maxLines, kind: 'missing-file' })
	return findings.sort((left, right) => left.file.localeCompare(right.file))
}

function trackedSources(repositoryRoot: string): Map<string, string> {
	const tracked = listRepositoryFiles({ cwd: repositoryRoot }).filter(isProductionSource)
	return new Map(tracked.map(file => [file, readFileSync(path.join(repositoryRoot, file), 'utf8')]))
}

if (import.meta.main) {
	const findings = inspectSourceSizes(trackedSources(repositoryRoot))
	if (findings.length === 0) {
		console.log(`Production source-size guard passed (${productionSourceLineLimit.toString()} line limit).`)
	} else {
		console.error(`Production source-size guard failed (${productionSourceLineLimit.toString()} line limit).`)
		for (const finding of findings) console.error(`${finding.file}: ${finding.lines.toString()} lines; configured limit ${finding.limit.toString()} (${finding.kind})${finding.detail === undefined ? '' : `; ${finding.detail}`}`)
		process.exitCode = 1
	}
}
