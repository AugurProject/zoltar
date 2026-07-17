import * as process from 'node:process'
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

export type CiChangeClassification = {
	heavy: boolean
	reason: string
}

const lightweightPathPatterns = [/\.md$/u, /^docs\//u, /^\.codex\/agents\//u, /^\.codex\/review-contract\.md$/u, /^AGENTS\.md$/u, /^ui\/AGENTS\.md$/u]

export function getCiChangedFiles(baseRef: string, cwd: string = process.cwd()) {
	const output = execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=ACMRTUXBD', `${baseRef}...HEAD`], { cwd, encoding: 'utf8' })
	return output.split('\0').filter(filePath => filePath !== '')
}

export function classifyCiChange(filePaths: readonly string[]): CiChangeClassification {
	if (filePaths.length === 0) return { heavy: true, reason: 'No changed paths were detected, so CI is using the safe full-suite fallback.' }

	const executablePaths = filePaths.filter(filePath => !lightweightPathPatterns.some(pattern => pattern.test(filePath)))
	if (executablePaths.length > 0) {
		return { heavy: true, reason: `Executable or configuration paths changed: ${executablePaths.join(', ')}` }
	}

	return { heavy: false, reason: 'Only documentation, review instructions, or agent definitions changed.' }
}

if (import.meta.main) {
	const args = process.argv.slice(2)
	const githubOutput = args[0] === '--github-output'
	const classificationArgs = githubOutput ? args.slice(1) : args
	const baseRef = classificationArgs[0] === '--base-ref' ? classificationArgs[1] : undefined
	if (classificationArgs[0] === '--base-ref' && baseRef === undefined) throw new Error('--base-ref requires a Git ref')
	const classification = classifyCiChange(baseRef === undefined ? classificationArgs : getCiChangedFiles(baseRef))
	if (githubOutput) {
		const outputPath = process.env['GITHUB_OUTPUT']
		if (outputPath === undefined) throw new Error('GITHUB_OUTPUT is required with --github-output')
		appendFileSync(outputPath, `heavy=${classification.heavy.toString()}\n`)
		const summaryPath = process.env['GITHUB_STEP_SUMMARY']
		if (summaryPath !== undefined) appendFileSync(summaryPath, `### CI scope\n\n${classification.reason}\n`)
	}
	console.log(JSON.stringify(classification))
}
