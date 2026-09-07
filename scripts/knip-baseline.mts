import type { Preprocessor, ReporterOptions } from 'knip'
import { relative } from 'node:path'
import baseline from './knip-baseline.json'

type Issue = ReporterOptions['issues']['exports'][string][string]

function issueKey(issue: Issue, cwd: string): string {
	return JSON.stringify([issue.type, relative(cwd, issue.filePath).replaceAll('\\', '/'), issue.parentSymbol ?? '', issue.symbol])
}

export function applyKnownKnipFindings(issues: Readonly<Record<string, ReporterOptions['issues']['exports'] | undefined>>, counters: Partial<ReporterOptions['counters']>, known: ReadonlySet<string>, cwd: string): number {
	let accepted = 0
	for (const files of Object.values(issues)) {
		if (files === undefined) continue
		for (const symbols of Object.values(files)) {
			for (const issue of Object.values(symbols)) {
				if (issue.severity === 'warn' || issue.severity === 'off' || issue.isFixed || !known.has(issueKey(issue, cwd))) continue
				const count = counters[issue.type]
				if (count === undefined || count < 1) throw new Error(`Invalid Knip counter for ${issue.type}`)
				issue.severity = 'warn'
				counters[issue.type] = count - 1
				accepted += 1
			}
		}
	}
	return accepted
}

const preprocess: Preprocessor = options => {
	const mode = options.isProduction ? 'production' : 'normal'
	const known = new Set(baseline[mode].map(entry => JSON.stringify(entry)))
	const accepted = applyKnownKnipFindings(options.issues, options.counters, known, options.cwd)
	console.error(`Knip ${mode}: ${accepted} retained baseline findings reported as warnings; new findings remain errors.`)
	return options
}

export default preprocess
