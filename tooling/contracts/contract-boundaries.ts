import * as path from 'node:path'

export type ContractBoundaryFinding = {
	readonly file: string
	readonly importPath: string
	readonly reason: string
}

const importPattern = /\bimport\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g

const resolveLocalImport = (sourcePath: string, importPath: string) => {
	if (!importPath.startsWith('.')) return undefined
	return path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), importPath))
}

export function findContractBoundaryViolations(sourcePath: string, source: string): ContractBoundaryFinding[] {
	const findings: ContractBoundaryFinding[] = []
	for (const match of source.matchAll(importPattern)) {
		const importPath = match[1]
		if (importPath === undefined) continue
		const resolved = resolveLocalImport(sourcePath, importPath)
		if (resolved === undefined) continue

		const sourceIsTest = sourcePath.startsWith('solidity/contracts/test/') || sourcePath.startsWith('solidity/contracts/trading/test/')
		const targetIsTest = resolved.startsWith('solidity/contracts/test/') || resolved.startsWith('solidity/contracts/trading/test/')
		if (!sourceIsTest && targetIsTest) {
			findings.push({ file: sourcePath, importPath, reason: 'production contracts must not import test contracts' })
			continue
		}

		if (sourcePath.startsWith('solidity/contracts/statoblast/') && resolved.startsWith('solidity/contracts/trading/')) {
			findings.push({ file: sourcePath, importPath, reason: 'Statoblast core must not depend on optional Trading contracts' })
			continue
		}

		if (sourcePath.startsWith('solidity/contracts/trading/') && resolved.startsWith('solidity/contracts/statoblast/')) {
			const allowed = resolved === 'solidity/contracts/statoblast/BinaryOutcomes.sol' || resolved.startsWith('solidity/contracts/statoblast/interfaces/') || resolved.startsWith('solidity/contracts/statoblast/openOracle/openzeppelin/')
			if (!allowed) findings.push({ file: sourcePath, importPath, reason: 'Trading may consume Statoblast only through interfaces, outcome types, and the existing vendored math library' })
		}

		if (sourcePath.startsWith('solidity/contracts/statoblast/openOracle/') && !resolved.startsWith('solidity/contracts/statoblast/openOracle/')) {
			findings.push({ file: sourcePath, importPath, reason: 'vendored OpenOracle sources must remain self-contained' })
		}
	}
	return findings
}
