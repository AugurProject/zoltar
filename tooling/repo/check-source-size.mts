import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
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

export const countSourceLines = (source: string): number => {
	if (source === '') return 0
	const lines = source.split(/\r?\n/)
	return lines.at(-1) === '' ? lines.length - 1 : lines.length
}

export function inspectSourceSizes(files: ReadonlyMap<string, string>, allowances: ReadonlyMap<string, SourceSizeAllowance> = sourceSizeAllowances, limit = productionSourceLineLimit): SourceSizeFinding[] {
	const findings: SourceSizeFinding[] = []
	const validAllowances = new Map<string, SourceSizeAllowance>()
	for (const [file, allowance] of allowances) {
		const lines = files.has(file) ? countSourceLines(files.get(file) ?? '') : 0
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
		const lines = countSourceLines(source)
		const allowance = validAllowances.get(file)
		if (allowance === undefined && lines > limit) findings.push({ file, lines, limit, kind: 'oversized' })
		else if (allowance !== undefined && lines > allowance.maxLines) findings.push({ file, lines, limit: allowance.maxLines, kind: 'allowance-exceeded' })
		else if (allowance !== undefined && lines <= limit) findings.push({ file, lines, limit, kind: 'stale-allowance' })
	}
	for (const [file, allowance] of validAllowances) if (!files.has(file)) findings.push({ file, lines: 0, limit: allowance.maxLines, kind: 'missing-file' })
	return findings.sort((left, right) => left.file.localeCompare(right.file))
}

function trackedSources(repositoryRoot: string): Map<string, string> {
	const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repositoryRoot, encoding: 'utf8' }).split('\0').filter(isProductionSource)
	return new Map(tracked.map(file => [file, readFileSync(path.join(repositoryRoot, file), 'utf8')]))
}

if (import.meta.main) {
	const repositoryRoot = path.resolve(import.meta.dir, '../..')
	const findings = inspectSourceSizes(trackedSources(repositoryRoot))
	if (findings.length === 0) {
		console.log(`Production source-size guard passed (${productionSourceLineLimit.toString()} line limit).`)
	} else {
		console.error(`Production source-size guard failed (${productionSourceLineLimit.toString()} line limit).`)
		for (const finding of findings) console.error(`${finding.file}: ${finding.lines.toString()} lines; configured limit ${finding.limit.toString()} (${finding.kind})${finding.detail === undefined ? '' : `; ${finding.detail}`}`)
		process.exitCode = 1
	}
}
