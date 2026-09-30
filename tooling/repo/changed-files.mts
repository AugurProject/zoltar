import { type GitRunner, mergeBaseWithMain, runGit } from './git.mts'

const CHANGED_FILE_DIFF_FILTER = 'ACMRTUXBD'

export type ChangedFileEntry = {
	path: string
	previousPath?: string
	status: 'added' | 'deleted' | 'modified' | 'renamed'
}

/** Final task paths against the merge base, including deletions and both sides of renames. */
export function getChangedFiles(runGitFn: GitRunner = runGit) {
	return [...new Set(getChangedFileEntries(runGitFn).flatMap(entry => (entry.previousPath === undefined ? [entry.path] : [entry.path, entry.previousPath])))].sort()
}

const parseNameStatus = (output: string): ChangedFileEntry[] => {
	const fields = output.split('\0')
	const changes: ChangedFileEntry[] = []
	for (let index = 0; index < fields.length; ) {
		const statusField = fields[index]
		index += 1
		if (statusField === undefined || statusField === '') continue
		const statusCode = statusField[0]
		if (statusCode === 'R' || statusCode === 'C') {
			const previousPath = fields[index]
			const filePath = fields[index + 1]
			index += 2
			if (previousPath === undefined || filePath === undefined) throw new Error(`Invalid Git name-status rename entry: ${statusField}`)
			changes.push({ path: filePath, previousPath, status: 'renamed' })
			continue
		}
		const filePath = fields[index]
		index += 1
		if (filePath === undefined) throw new Error(`Invalid Git name-status entry: ${statusField}`)
		let status: ChangedFileEntry['status'] = 'modified'
		if (statusCode === 'A') status = 'added'
		else if (statusCode === 'D') status = 'deleted'
		changes.push({ path: filePath, status })
	}
	return changes
}

/** Paths touched by commits on HEAD since it diverged from `baseRef`, including both sides of renames and copies. */
export function getCommittedChangedPaths(baseRef: string, runGitFn: GitRunner = runGit) {
	const changes = parseNameStatus(runGitFn(['diff', '--name-status', '-z', '--find-renames', `--diff-filter=${CHANGED_FILE_DIFF_FILTER}`, `${baseRef}...HEAD`]))
	return [...new Set(changes.flatMap(change => (change.previousPath === undefined ? [change.path] : [change.previousPath, change.path])))].sort()
}

export function getChangedFileEntries(runGitFn: GitRunner = runGit) {
	const changesByPath = new Map<string, ChangedFileEntry>()
	const mergeBase = mergeBaseWithMain(runGitFn)
	for (const change of parseNameStatus(runGitFn(['diff', '--name-status', '-z', '--find-renames', `--diff-filter=${CHANGED_FILE_DIFF_FILTER}`, mergeBase]))) changesByPath.set(change.path, change)
	for (const filePath of runGitFn(['ls-files', '-z', '--others', '--exclude-standard']).split('\0')) {
		if (filePath !== '') changesByPath.set(filePath, { path: filePath, status: 'added' })
	}
	return [...changesByPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}
