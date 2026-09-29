import { spawnSync } from 'node:child_process'

export type GitRunner = (args: string[]) => string

type RunGitOptions = {
	cwd?: string | undefined
	/** Trims surrounding whitespace from the output; disable for NUL-separated listings and file contents. */
	trim?: boolean
}

const gitOutputLimitBytes = 64 * 1024 * 1024

/** Runs Git synchronously and returns its stdout, throwing with Git's stderr when the command fails. */
export function runGit(args: readonly string[], options: RunGitOptions = {}): string {
	const result = spawnSync('git', args, { cwd: options.cwd, encoding: 'utf8', maxBuffer: gitOutputLimitBytes })
	if (result.error !== undefined) throw result.error
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed${result.stderr.trim() === '' ? '' : `: ${result.stderr.trim()}`}`)
	return options.trim === false ? result.stdout : result.stdout.trim()
}

type ListRepositoryFilesOptions = {
	cwd?: string | undefined
	/** Includes tracked files; defaults to true. */
	tracked?: boolean
	/** Includes untracked files that are not ignored; defaults to false. */
	untracked?: boolean
	pathspec?: readonly string[]
}

/** Lists repository files relative to `cwd` (tracked by default), without Git's path quoting. */
export function listRepositoryFiles(options: ListRepositoryFilesOptions = {}): string[] {
	const args = ['ls-files', '-z']
	if (options.tracked !== false) args.push('--cached')
	if (options.untracked === true) args.push('--others', '--exclude-standard')
	if (options.pathspec !== undefined && options.pathspec.length > 0) args.push('--', ...options.pathspec)
	return runGit(args, { cwd: options.cwd, trim: false })
		.split('\0')
		.filter(filePath => filePath !== '')
}

/** Resolves the merge base of `baseRef` (origin/main by default) and HEAD. */
export function mergeBaseWithMain(runGitFn: GitRunner = runGit, baseRef = 'origin/main'): string {
	const mergeBase = runGitFn(['merge-base', baseRef, 'HEAD']).trim()
	if (mergeBase === '') throw new Error(`Git could not resolve the merge base of ${baseRef} and HEAD`)
	return mergeBase
}
