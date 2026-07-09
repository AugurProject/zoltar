import { execFileSync } from 'node:child_process'
import { getChangedFiles } from './changed-files.mts'

function runCommand(command: string, args: string[]) {
	return execFileSync(command, args, { encoding: 'utf8', stdio: 'inherit' })
}

const BIOME_COVERED_FILE_PATTERNS = [
	/^(package\.json|\.prettierrc\.json|shared\/package\.json|ui\/package\.json|solidity\/package\.json|tsconfig\.scripts\.json)$/,
	/^bun-test-setup[^/]*\.ts$/,
	/^README\.md$/,
	/^AGENTS\.md$/,
	/^docs\//,
	/^scripts\//,
	/^shared\/ts\//,
	/^solidity\/ts\//,
	/^ui\/AGENTS\.md$/,
	/^ui\/ts\//,
	/^ui\/build\//,
	/^ui\/dev-server\.ts$/,
	/^ui\/css\//,
]

function isBiomeCoveredChangedFile(filePath: string) {
	return BIOME_COVERED_FILE_PATTERNS.some(pattern => pattern.test(filePath))
}

export function getBiomeChangedFiles(changedFiles: string[]) {
	return changedFiles.filter(filePath => !filePath.endsWith('.sol') && isBiomeCoveredChangedFile(filePath))
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
