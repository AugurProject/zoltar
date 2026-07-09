import { execFileSync } from 'node:child_process'
import { getChangedFiles } from './changed-files.mts'

function runCommand(command: string, args: string[]) {
	return execFileSync(command, args, { encoding: 'utf8', stdio: 'inherit' })
}

export function getBiomeChangedFiles(changedFiles: string[]) {
	return changedFiles.filter(filePath => !filePath.endsWith('.sol'))
}

if (import.meta.main) {
	let changedFiles: string[]
	try {
		changedFiles = getChangedFiles()
	} catch (error) {
		console.error('check-changed: unable to compute changed files against origin/main. Fetch origin/main and retry.')
		throw error
	}

	if (changedFiles.length === 0) {
		console.log('check-changed: no changed files to audit')
		process.exit(0)
	}

	const biomeChangedFiles = getBiomeChangedFiles(changedFiles)

	if (biomeChangedFiles.length === 0) {
		console.log('check-changed: no Biome-covered changed files to audit')
		process.exit(0)
	}

	runCommand('bunx', ['@biomejs/biome', 'check', ...biomeChangedFiles])
}
