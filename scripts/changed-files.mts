import { execFileSync } from 'node:child_process'

export const CHANGED_FILE_DIFF_FILTER = 'ACMRTUXB'

function runGit(args: string[]) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

export function getChangedFiles(runGitFn: (args: string[]) => string = runGit) {
	const changedFiles = new Set<string>()
	const fileLists = [
		runGitFn(['diff', '--name-only', `--diff-filter=${CHANGED_FILE_DIFF_FILTER}`, 'origin/main...HEAD']),
		runGitFn(['diff', '--name-only', `--diff-filter=${CHANGED_FILE_DIFF_FILTER}`]),
		runGitFn(['diff', '--cached', '--name-only', `--diff-filter=${CHANGED_FILE_DIFF_FILTER}`]),
		runGitFn(['ls-files', '--others', '--exclude-standard']),
	]

	for (const fileList of fileLists) {
		for (const filePath of fileList.split('\n')) {
			if (filePath === '') continue
			changedFiles.add(filePath)
		}
	}

	return [...changedFiles].sort()
}
