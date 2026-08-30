import { execFileSync } from 'node:child_process'

export const CHANGED_FILE_DIFF_FILTER = 'ACMRTUXB'
export const TEST_PLAN_DIFF_FILTER = `${CHANGED_FILE_DIFF_FILTER}D`

export type ChangedFileEntry = {
	path: string
	previousPath?: string
	status: 'added' | 'deleted' | 'modified' | 'renamed'
}

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

export function getChangedFileEntries(runGitFn: (args: string[]) => string = runGit) {
	const changesByPath = new Map<string, ChangedFileEntry>()
	const applyChange = (change: ChangedFileEntry) => {
		const existing = changesByPath.get(change.path)
		if (change.status === 'modified') {
			if (existing === undefined) changesByPath.set(change.path, change)
			return
		}
		if (change.status === 'added') {
			if (existing?.status === 'deleted') changesByPath.set(change.path, { path: change.path, status: 'modified' })
			else if (existing === undefined) changesByPath.set(change.path, change)
			return
		}
		if (change.status === 'deleted') {
			if (existing?.status === 'added') changesByPath.delete(change.path)
			else if (existing?.status === 'renamed') {
				changesByPath.delete(change.path)
				if (existing.previousPath !== undefined) changesByPath.set(existing.previousPath, { path: existing.previousPath, status: 'deleted' })
			} else changesByPath.set(change.path, change)
			return
		}
		if (change.previousPath === undefined) throw new Error(`Rename is missing its previous path: ${change.path}`)
		const renamedExisting = changesByPath.get(change.previousPath)
		changesByPath.delete(change.previousPath)
		if (renamedExisting?.status === 'added') changesByPath.set(change.path, { path: change.path, status: 'added' })
		else changesByPath.set(change.path, { path: change.path, previousPath: renamedExisting?.previousPath ?? change.previousPath, status: 'renamed' })
	}
	const diffArguments = [
		['diff', '--name-status', '-z', '--find-renames', `--diff-filter=${TEST_PLAN_DIFF_FILTER}`, 'origin/main...HEAD'],
		['diff', '--cached', '--name-status', '-z', '--find-renames', `--diff-filter=${TEST_PLAN_DIFF_FILTER}`],
		['diff', '--name-status', '-z', '--find-renames', `--diff-filter=${TEST_PLAN_DIFF_FILTER}`],
	]
	for (const args of diffArguments) {
		for (const change of parseNameStatus(runGitFn(args))) applyChange(change)
	}
	for (const filePath of runGitFn(['ls-files', '-z', '--others', '--exclude-standard']).split('\0')) {
		if (filePath !== '') applyChange({ path: filePath, status: 'added' })
	}
	return [...changesByPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}
