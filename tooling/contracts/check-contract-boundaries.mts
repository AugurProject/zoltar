import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { findContractBoundaryViolations } from './contract-boundaries.js'

const repositoryRoot = path.resolve(import.meta.dir, '..', '..')
const contractRoot = path.join(repositoryRoot, 'solidity', 'contracts')

async function collectSolidityFiles(directory: string, files: string[] = []): Promise<string[]> {
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name)
		if (entry.isDirectory()) await collectSolidityFiles(entryPath, files)
		else if (entry.isFile() && entry.name.endsWith('.sol')) files.push(entryPath)
	}
	return files
}

const findings = []
for (const filePath of await collectSolidityFiles(contractRoot)) {
	const sourcePath = path.relative(repositoryRoot, filePath).replaceAll('\\', '/')
	findings.push(...findContractBoundaryViolations(sourcePath, await fs.readFile(filePath, 'utf8')))
}

if (findings.length > 0) {
	for (const finding of findings) console.error(`${finding.file}: ${finding.reason}: ${finding.importPath}`)
	process.exitCode = 1
}
