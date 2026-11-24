import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { classifyCiChange } from '../ci/classify-ci-change.mts'
import { listRepositoryFiles, runGit } from '../repo/git.mts'
import type { LcovRecord } from './lcov.mts'

// A report-only hypothesis. Full captures remain authoritative until repeated
// same-source comparisons establish the exact covered-line set.
export const TYPESCRIPT_COVERAGE_BRIDGES = [
	'solidity/ts/tests/trading/pairRouter.integration.test.ts',
	'solidity/ts/tests/trading/realCore.integration.test.ts',
	'solidity/ts/tests/trading/securityPoolMint.integration.test.ts',
	'solidity/ts/tests/deploymentStatusOracle.test.ts',
	'solidity/ts/tests/statoblast/deploymentStatusOracleOrder.test.ts',
	'solidity/ts/tests/escalationGameInterfaceRegression.test.ts',
	'solidity/ts/tests/statoblast/securityPoolAdmission.test.ts',
	'solidity/ts/tests/statoblast/securityPoolAuctionGas.test.ts',
] as const

export function selectCoveragePilotFiles(canonical: readonly string[], changed: readonly string[]) {
	const canBoundConsumers = changed.length === 0 || classifyCiChange([...changed]).shadowSolidityRoute === 'application-only'
	if (!canBoundConsumers || TYPESCRIPT_COVERAGE_BRIDGES.some(file => !canonical.includes(file))) return { mode: 'full-fallback', files: [...canonical] }
	const bridges = new Set<string>(TYPESCRIPT_COVERAGE_BRIDGES)
	return { mode: 'application-and-bridges', files: canonical.filter(file => !file.startsWith('solidity/') || bridges.has(file)) }
}

export type CoverageProvenance = { revision: string; sources: string; artifacts: string }
export async function captureCoverageProvenance(repositoryRoot = process.cwd()): Promise<CoverageProvenance> {
	const sources = createHash('sha256')
	for (const file of listRepositoryFiles({ cwd: repositoryRoot, untracked: true }).sort()) {
		// Deletions are represented by their path and marker, not silently omitted.
		sources.update(`${file}\0`)
		try {
			sources.update(await readFile(resolve(repositoryRoot, file)))
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
			sources.update('<deleted>')
		}
		sources.update('\0')
	}
	return {
		revision: runGit(['rev-parse', 'HEAD'], { cwd: repositoryRoot }),
		sources: sources.digest('hex'),
		artifacts: createHash('sha256')
			.update(await readFile(resolve(repositoryRoot, 'solidity/artifacts/Contracts.json')))
			.digest('hex'),
	}
}

export function compareCoverageLineSets(full: Map<string, LcovRecord>, pilot: Map<string, LcovRecord>, fullProvenance: CoverageProvenance, pilotProvenance: CoverageProvenance) {
	if (fullProvenance.revision !== pilotProvenance.revision || fullProvenance.sources !== pilotProvenance.sources || fullProvenance.artifacts !== pilotProvenance.artifacts) throw new Error('Coverage captures have different source or artifact provenance')
	const lines = (records: Map<string, LcovRecord>) => new Set([...records].flatMap(([file, record]) => (/^(ui|shared|tooling)\//.test(file) && !/\.(test|spec)\.[cm]?tsx?$/.test(file) ? [...record.lineHits].filter(([, hits]) => hits > 0).map(([line]) => `${file}:${line}`) : [])))
	const control = lines(full)
	const candidate = lines(pilot)
	return { missing: [...control].filter(line => !candidate.has(line)).sort(), additional: [...candidate].filter(line => !control.has(line)).sort() }
}

if (import.meta.main) {
	const [fullDirectory, pilotDirectory] = process.argv.slice(2)
	if (fullDirectory === undefined || pilotDirectory === undefined) throw new Error('Usage: coverage-pilot.mts <full capture directory> <pilot capture directory>')
	const { isPlainRecord } = await import('@zoltar/core-shared/validation/guards')
	const { parseLcov } = await import('./lcov.mts')
	const { remapGeneratedTypeScriptLcovRecords } = await import('./coverage-source-maps.mts')
	const { writeFile } = await import('node:fs/promises')
	const load = async (directory: string, expectedStatus: string) => {
		const manifest: unknown = JSON.parse(await readFile(resolve(directory, 'test-files.json'), 'utf8'))
		if (!isPlainRecord(manifest) || manifest['status'] !== expectedStatus || !isPlainRecord(manifest['provenance'])) throw new Error('Capture is incomplete or lacks provenance')
		const provenance = manifest['provenance']
		const revision = provenance['revision']
		const sources = provenance['sources']
		const artifacts = provenance['artifacts']
		if (typeof revision !== 'string' || typeof sources !== 'string' || typeof artifacts !== 'string') throw new Error('Invalid coverage provenance')
		return { provenance: { revision, sources, artifacts }, records: await remapGeneratedTypeScriptLcovRecords(parseLcov(await readFile(resolve(directory, 'lcov.info'), 'utf8'))) }
	}
	const full = await load(fullDirectory, 'passed')
	const pilot = await load(pilotDirectory, 'report-only')
	const comparison = compareCoverageLineSets(full.records, pilot.records, full.provenance, pilot.provenance)
	await writeFile(resolve(pilotDirectory, 'line-set-comparison.json'), `${JSON.stringify(comparison, undefined, 2)}\n`)
	console.log(`Report-only comparison: ${comparison.missing.length} missing and ${comparison.additional.length} additional covered lines. Function and branch equivalence is not established.`)
}
