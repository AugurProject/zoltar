import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { getChangedFiles } from './changed-files.mts'

function runCommand(command: string, args: string[]) {
	return execFileSync(command, args, { encoding: 'utf8', stdio: 'inherit' })
}

/**
 * Biome decides which of these paths it owns through `files.includes` in biome.json; with `--no-errors-on-unmatched` it skips
 * excluded paths silently, so a change set made only of excluded files (regenerated docs bundles, for example) passes. This
 * filter only removes file types Biome never processes.
 */
const BIOME_CHECKED_EXTENSIONS = /\.(?:cjs|css|cts|html|js|json|jsonc|jsx|mjs|mts|ts|tsx)$/

export function getBiomeChangedFiles(changedFiles: string[]) {
	return changedFiles.filter(filePath => BIOME_CHECKED_EXTENSIONS.test(filePath))
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

	const biomeChangedFiles = getBiomeChangedFiles(changedFiles).filter(existsSync)

	if (biomeChangedFiles.length === 0) {
		console.log('check-changed: no Biome file types among the changed files')
		process.exit(0)
	}

	runCommand('bunx', ['@biomejs/biome', 'check', '--no-errors-on-unmatched', ...biomeChangedFiles])
}
