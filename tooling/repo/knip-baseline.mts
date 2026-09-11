import type { Preprocessor, ReporterOptions } from 'knip'
import { relative } from 'node:path'
import baseline from './knip-baseline.json'

type Issue = ReporterOptions['issues']['exports'][string][string]

export type KnownFindingApplication = {
	/** Baseline entries that matched a current finding and were downgraded to warnings. */
	accepted: number
	/** Baseline entries (as JSON tuples) that matched no current finding and must be removed from the baseline. */
	unmatched: readonly string[]
}

function issueKey(issue: Issue, cwd: string): string {
	return JSON.stringify([issue.type, relative(cwd, issue.filePath).replaceAll('\\', '/'), issue.parentSymbol ?? '', issue.symbol])
}

export function applyKnownKnipFindings(issues: Readonly<Record<string, ReporterOptions['issues']['exports'] | undefined>>, counters: Partial<ReporterOptions['counters']>, known: ReadonlySet<string>, cwd: string): KnownFindingApplication {
	let accepted = 0
	const matched = new Set<string>()
	for (const files of Object.values(issues)) {
		if (files === undefined) continue
		for (const symbols of Object.values(files)) {
			for (const issue of Object.values(symbols)) {
				const key = issueKey(issue, cwd)
				if (!known.has(key)) continue
				matched.add(key)
				if (issue.severity === 'warn' || issue.severity === 'off' || issue.isFixed) continue
				const count = counters[issue.type]
				if (count === undefined || count < 1) throw new Error(`Invalid Knip counter for ${issue.type}`)
				issue.severity = 'warn'
				counters[issue.type] = count - 1
				accepted += 1
			}
		}
	}
	return { accepted, unmatched: [...known].filter(key => !matched.has(key)) }
}

export type KnipBaseline = { readonly normal: readonly (readonly string[])[]; readonly production: readonly (readonly string[])[] }

export function createKnipBaselinePreprocessor(knownFindings: KnipBaseline, baselineLabel: string): Preprocessor {
	return options => {
		const mode = options.isProduction ? 'production' : 'normal'
		const known = new Set(knownFindings[mode].map(entry => JSON.stringify(entry)))
		const { accepted, unmatched } = applyKnownKnipFindings(options.issues, options.counters, known, options.cwd)
		console.error(`Knip ${mode}: ${accepted} retained baseline findings reported as warnings; new findings remain errors.`)
		if (unmatched.length > 0) {
			for (const entry of unmatched) console.error(`  stale baseline entry: ${entry}`)
			throw new Error(`Knip ${mode}: ${unmatched.length} baseline entries in ${baselineLabel} matched no current finding. Remove them so the baseline can only shrink.`)
		}
		return options
	}
}

export default createKnipBaselinePreprocessor(baseline, 'tooling/repo/knip-baseline.json')
