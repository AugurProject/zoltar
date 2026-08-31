import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { getChangedFiles } from './changed-files.mts'

function runCommand(command: string, args: string[]) {
	return execFileSync(command, args, { encoding: 'utf8', stdio: 'inherit' })
}

const BIOME_COVERED_FILE_PATTERNS = [
	/^(package\.json|\.prettierrc\.json|shared\/package\.json|ui\/(?:coreShared|zoltar|statoblast|trading)\/package\.json|solidity\/package\.json|tsconfig\.scripts\.json)$/,
	/^bun-test-setup[^/]*\.ts$/,
	/^README\.md$/,
	/^AGENTS\.md$/,
	/^\.codex\/review-contract\.md$/,
	/^docs\//,
	/^scripts\//,
	/^shared\/ts\//,
	/^solidity\/ts\//,
	/^ui\/AGENTS\.md$/,
	/^ui\/coreShared\/ts\//,
	/^ui\/coreShared\/build\//,
	/^ui\/coreShared\/dev-server\.ts$/,
	/^ui\/coreShared\/css\//,
	/^ui\/zoltar\/ts\//,
	/^ui\/statoblast\/ts\//,
	/^ui\/trading\/ts\//,
	/^ui\/trading\/css\//,
]

const BIOME_CHECKED_EXTENSIONS = /\.(?:cjs|css|cts|html|js|json|jsonc|jsx|mjs|mts|ts|tsx)$/

function isBiomeCoveredChangedFile(filePath: string) {
	return BIOME_COVERED_FILE_PATTERNS.some(pattern => pattern.test(filePath))
}

export function getBiomeChangedFiles(changedFiles: string[]) {
	return changedFiles.filter(filePath => BIOME_CHECKED_EXTENSIONS.test(filePath) && isBiomeCoveredChangedFile(filePath))
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
		console.log('check-changed: no Biome-covered changed files to audit')
		process.exit(0)
	}

	runCommand('bunx', ['@biomejs/biome', 'check', ...biomeChangedFiles])
}
