import * as path from 'node:path'
import { existsSync } from 'node:fs'

export interface SolidityBytecodeCoverageConfig {
	readonly enabled: boolean
	readonly rootPath: string
	readonly artifactsPath: string
	readonly coverageDirectory: string
	readonly lcovPath: string
	readonly summaryPath: string
}

const getProjectRoot = (): string => {
	let currentPath = process.cwd()
	while (currentPath !== path.dirname(currentPath)) {
		if (existsSync(path.join(currentPath, 'solidity', 'artifacts', 'Contracts.json'))) return currentPath
		if (existsSync(path.join(currentPath, 'artifacts', 'Contracts.json'))) return currentPath
		currentPath = path.dirname(currentPath)
	}
	return process.cwd()
}

export const isSolidityBytecodeCoverageEnabled = (): boolean => process.env['SOLIDITY_BYTECODE_COVERAGE'] === '1'

export const getSolidityBytecodeCoverageConfig = (): SolidityBytecodeCoverageConfig => {
	const rootPath = getProjectRoot()
	const artifactsPath = path.join(rootPath, 'solidity', 'artifacts', 'Contracts.json')
	const coverageDirectory = path.join(rootPath, 'solidity', 'coverage')

	return {
		enabled: isSolidityBytecodeCoverageEnabled(),
		rootPath,
		artifactsPath,
		coverageDirectory,
		lcovPath: path.join(coverageDirectory, 'lcov.info'),
		summaryPath: path.join(coverageDirectory, 'coverage-summary.json'),
	}
}
