#!/usr/bin/env bun

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import * as url from 'node:url'
import { buildVerificationPlan, getExplorerTargets, getSourcifyTarget, parseDeploymentManifest, verifyContractsWithExplorer, verifyContractsWithSourcify, type ArtifactLookup, type DeploymentManifest, type StandardJsonInputs, type VerificationOutcome, type VerificationPlan } from './contract-verification.mts'

const repositoryRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..')
const CONTRACT_ARTIFACT_PATH = path.join(repositoryRoot, 'solidity', 'artifacts', 'Contracts.json')
const NETWORK_IDS_BY_CHAIN_ID: Readonly<Record<number, 'mainnet' | 'sepolia'>> = {
	1: 'mainnet',
	11_155_111: 'sepolia',
}

export function parseRequestedChainIds(argv: readonly string[]): number[] {
	const prefix = '--chain-id='
	const values = argv.filter(argument => argument.startsWith(prefix)).map(argument => argument.slice(prefix.length))
	if (values.length === 0) return Object.keys(NETWORK_IDS_BY_CHAIN_ID).map(Number)
	return values.map(value => {
		if (!/^[1-9]\d*$/.test(value)) throw new Error(`--chain-id must be a canonical positive decimal integer, received ${value}`)
		return Number(value)
	})
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

export function createArtifactLookup(rawArtifact: unknown): ArtifactLookup {
	if (!isRecord(rawArtifact) || !isRecord(rawArtifact['contracts'])) throw new Error('Contract artifact must contain a contracts object')
	const contracts = rawArtifact['contracts']
	return (sourcePath, contractName) => {
		const contractFile = contracts[sourcePath]
		if (!isRecord(contractFile) || !isRecord(contractFile[contractName])) throw new Error(`Contract artifact is missing ${sourcePath}:${contractName}`)
		const evm = contractFile[contractName]['evm']
		if (!isRecord(evm) || !isRecord(evm['bytecode']) || typeof evm['bytecode']['object'] !== 'string') throw new Error(`Contract artifact ${sourcePath}:${contractName} has no creation bytecode`)
		return { creationBytecode: evm['bytecode']['object'] }
	}
}

async function loadArtifactLookup(): Promise<ArtifactLookup> {
	let rawArtifactJson: string
	try {
		rawArtifactJson = await fs.readFile(CONTRACT_ARTIFACT_PATH, 'utf8')
	} catch (error) {
		throw new Error(`Unable to read ${path.relative(repositoryRoot, CONTRACT_ARTIFACT_PATH)}. Run bun run ensure-contract-artifacts first.`, { cause: error })
	}
	return createArtifactLookup(JSON.parse(rawArtifactJson))
}

async function loadManifest(networkId: 'mainnet' | 'sepolia'): Promise<DeploymentManifest> {
	const manifestPath = path.join(repositoryRoot, 'docs', `${networkId}-deployment-addresses.json`)
	const rawManifest: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
	return parseDeploymentManifest(rawManifest, networkId)
}

function toExplorerCompilerVersion(compilerVersion: string): string {
	return `v${compilerVersion.replace(/\.Emscripten\.clang$/, '')}`
}

function buildSourceObject(sources: ReadonlyMap<string, string>): Record<string, { content: string }> {
	return Object.fromEntries(Array.from(sources, ([sourcePath, content]) => [sourcePath, { content }]))
}

async function buildStandardJsonInputs(plan: VerificationPlan): Promise<StandardJsonInputs> {
	const compileModule = await import('../../solidity/ts/compile.ts')
	const sources = await compileModule.loadContractSources()
	const libraries = {
		'contracts/ScalarOutcomes.sol': { ScalarOutcomes: plan.libraryAddresses.scalarOutcomes },
		'contracts/statoblast/SecurityPoolUtils.sol': { SecurityPoolUtils: plan.libraryAddresses.securityPoolUtils },
	}
	return {
		main: {
			compilerVersion: toExplorerCompilerVersion(compileModule.getMainCompilerVersion()),
			inputJson: JSON.stringify({
				language: 'Solidity',
				settings: { ...compileModule.mainCompilerSettings, libraries },
				sources: buildSourceObject(compileModule.createMainCompilerSources(sources)),
			}),
		},
		openOracle: {
			compilerVersion: toExplorerCompilerVersion((await compileModule.loadOpenOracleCompiler()).version()),
			inputJson: JSON.stringify({
				language: 'Solidity',
				settings: compileModule.openOracleCompilerSettings,
				sources: buildSourceObject(compileModule.createOpenOracleCompilerSources(sources)),
			}),
		},
	}
}

function summarizeOutcomes(outcomes: readonly VerificationOutcome[]): { failed: number; summary: string } {
	const counts = { 'already-verified': 0, failed: 0, 'not-deployed': 0, verified: 0 }
	for (const outcome of outcomes) counts[outcome.status] += 1
	const summary = `${counts.verified.toString()} verified, ${counts['already-verified'].toString()} already verified, ${counts['not-deployed'].toString()} not deployed, ${counts.failed.toString()} failed`
	return { failed: counts.failed, summary }
}

export async function main(argv: readonly string[] = process.argv.slice(2), environment: Readonly<Record<string, string | undefined>> = process.env): Promise<number> {
	const chainIds = parseRequestedChainIds(argv)
	const artifactLookup = await loadArtifactLookup()
	let failures = 0
	for (const chainId of chainIds) {
		const networkId = NETWORK_IDS_BY_CHAIN_ID[chainId]
		if (networkId === undefined) {
			console.log(`Chain ${chainId.toString()} has no known Etherscan, Blockscout, or Sourcify support; skipping contract source verification.`)
			continue
		}
		const manifest = await loadManifest(networkId)
		if (manifest.network.chainId !== chainId) throw new Error(`The ${networkId} deployment manifest declares chain ${manifest.network.chainId.toString()}, expected ${chainId.toString()}`)
		const plan = buildVerificationPlan(manifest, artifactLookup)
		console.log(`Verifying ${plan.jobs.length.toString()} ${networkId} contracts (chain ${chainId.toString()})`)
		for (const skippedStep of plan.skipped) console.log(`  Skipping ${skippedStep.id}: ${skippedStep.reason}`)
		const inputs = await buildStandardJsonInputs(plan)
		for (const target of getExplorerTargets(chainId, environment)) {
			if (target.requiresApiKey && target.apiKey === undefined) {
				console.log(`Skipping ${target.name} on ${networkId}: set ETHERSCAN_API_KEY to verify there.`)
				continue
			}
			console.log(`${target.name} (${target.apiUrl})`)
			const outcomes = await verifyContractsWithExplorer({
				fetchFn: fetch,
				inputs,
				jobs: plan.jobs,
				log: console.log,
				sleep: milliseconds => Bun.sleep(milliseconds),
				target,
			})
			const { failed, summary } = summarizeOutcomes(outcomes)
			console.log(`${target.name} on ${networkId}: ${summary}`)
			failures += failed
		}
		const sourcifyTarget = getSourcifyTarget(chainId)
		if (sourcifyTarget !== undefined) {
			console.log(`${sourcifyTarget.name} (${sourcifyTarget.apiUrl})`)
			const outcomes = await verifyContractsWithSourcify({
				fetchFn: fetch,
				inputs,
				jobs: plan.jobs,
				log: console.log,
				sleep: milliseconds => Bun.sleep(milliseconds),
				target: sourcifyTarget,
			})
			const { failed, summary } = summarizeOutcomes(outcomes)
			console.log(`${sourcifyTarget.name} on ${networkId}: ${summary}`)
			failures += failed
		}
	}
	if (failures > 0) console.error(`Contract source verification failed for ${failures.toString()} contract submissions.`)
	return failures > 0 ? 1 : 0
}

if (import.meta.main) {
	process.exitCode = await main().catch(error => {
		console.error(error instanceof Error ? error.message : error)
		return 1
	})
}
