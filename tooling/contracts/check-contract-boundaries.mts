import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { repositoryRoot } from '../repo/root.mts'
import { walkFiles } from '../repo/walk.mts'
import { findContractBoundaryViolations } from './contract-boundaries.js'

const contractRoot = path.join(repositoryRoot, 'solidity', 'contracts')

async function collectSolidityFiles(directory: string): Promise<string[]> {
	return await walkFiles(directory, { include: file => file.endsWith('.sol') })
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
