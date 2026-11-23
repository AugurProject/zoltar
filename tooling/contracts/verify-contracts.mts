#!/usr/bin/env bun
import { repositoryRoot } from '../repo/root.mts'

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import { getDeploymentManifestFileName, getDeploymentManifestId } from './deployment-manifests.mts'
import { buildVerificationPlan, getExplorerTargets, getSourcifyTarget, parseDeploymentManifest, verifyContractsWithExplorer, verifyContractsWithSourcify, type ArtifactLookup, type DeploymentManifest, type ExplorerFetch, type StandardJsonInputs, type VerificationOutcome } from './contract-verification.mts'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'

const CONTRACT_ARTIFACT_PATH = path.join(repositoryRoot, 'solidity', 'artifacts', 'Contracts.json')
const NETWORK_IDS_BY_CHAIN_ID: Readonly<Record<number, 'mainnet' | 'sepolia'>> = {
	1: 'mainnet',
	11_155_111: 'sepolia',
}

const VERIFY_CONTRACTS_HELP = `Submit deployed Zoltar contract sources to Etherscan, Blockscout, and Sourcify

  bun run verify:contracts -- [--chain-id=<chain ID>]...

  --chain-id=<id>, --chain-id <id>  Verify one chain; repeat for more. Defaults to Mainnet and Sepolia.
  --help, -h                        Print this help without submitting anything.

Set ETHERSCAN_API_KEY to include Etherscan; Blockscout and Sourcify need no key.`

type VerificationRequest = { kind: 'help' } | { kind: 'verify'; chainIds: number[] }

function parseChainIdValue(value: string | undefined) {
	if (value === undefined || value.startsWith('-')) throw new Error('--chain-id requires a chain ID value')
	if (!/^[1-9]\d*$/.test(value)) throw new Error(`--chain-id must be a canonical positive decimal integer, received ${value}`)
	const chainId = Number(value)
	if (!Number.isSafeInteger(chainId)) throw new Error(`--chain-id must be a safe integer, received ${value}`)
	return chainId
}

export function parseVerificationRequest(argv: readonly string[]): VerificationRequest {
	if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help' }
	const prefix = '--chain-id='
	const chainIds: number[] = []
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]
		if (argument === undefined) continue
		if (argument === '--chain-id') {
			index += 1
			chainIds.push(parseChainIdValue(argv[index]))
		} else if (argument.startsWith(prefix)) {
			chainIds.push(parseChainIdValue(argument.slice(prefix.length)))
		} else {
			throw new Error(`Unknown argument ${argument}. Run with --help for usage.`)
		}
	}
	return { kind: 'verify', chainIds: chainIds.length === 0 ? Object.keys(NETWORK_IDS_BY_CHAIN_ID).map(Number) : chainIds }
}

export function createArtifactLookup(rawArtifact: unknown): ArtifactLookup {
	if (!isPlainRecord(rawArtifact) || !isPlainRecord(rawArtifact['contracts'])) throw new Error('Contract artifact must contain a contracts object')
	const contracts = rawArtifact['contracts']
	return (sourcePath, contractName) => {
		const contractFile = contracts[sourcePath]
		if (!isPlainRecord(contractFile) || !isPlainRecord(contractFile[contractName])) throw new Error(`Contract artifact is missing ${sourcePath}:${contractName}`)
		const evm = contractFile[contractName]['evm']
		if (!isPlainRecord(evm) || !isPlainRecord(evm['bytecode']) || typeof evm['bytecode']['object'] !== 'string') throw new Error(`Contract artifact ${sourcePath}:${contractName} has no creation bytecode`)
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

async function loadManifest(networkId: 'mainnet' | 'sepolia', genesisOutcome: 'yes' | 'no'): Promise<DeploymentManifest> {
	const manifestPath = path.join(repositoryRoot, 'docs', getDeploymentManifestFileName(getDeploymentManifestId(networkId, genesisOutcome)))
	const rawManifest: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
	return parseDeploymentManifest(rawManifest, networkId, genesisOutcome)
}

function toExplorerCompilerVersion(compilerVersion: string): string {
	return `v${compilerVersion.replace(/\.Emscripten\.clang$/, '')}`
}

function buildSourceObject(sources: ReadonlyMap<string, string>): Record<string, { content: string }> {
	return Object.fromEntries(Array.from(sources, ([sourcePath, content]) => [sourcePath, { content }]))
}

async function buildStandardJsonInputs(): Promise<StandardJsonInputs> {
	const compileModule = await import('../../solidity/ts/compile.ts')
	const sources = await compileModule.loadContractSources()
	return {
		main: {
			compilerVersion: toExplorerCompilerVersion(compileModule.getMainCompilerVersion()),
			inputJson: JSON.stringify({
				language: 'Solidity',
				settings: compileModule.mainCompilerSettings,
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

export async function main(
	argv: readonly string[] = process.argv.slice(2),
	environment: Readonly<Record<string, string | undefined>> = process.env,
	dependencies: { fetchFn: ExplorerFetch; sleep: (milliseconds: number) => Promise<void> } = { fetchFn: fetch, sleep: milliseconds => Bun.sleep(milliseconds) },
): Promise<number> {
	const request = parseVerificationRequest(argv)
	if (request.kind === 'help') {
		console.log(VERIFY_CONTRACTS_HELP)
		return 0
	}
	const { chainIds } = request
	const artifactLookup = await loadArtifactLookup()
	let failures = 0
	for (const chainId of chainIds) {
		const networkId = NETWORK_IDS_BY_CHAIN_ID[chainId]
		if (networkId === undefined) {
			console.log(`Chain ${chainId.toString()} has no known Etherscan, Blockscout, or Sourcify support; skipping contract source verification.`)
			continue
		}
		const plannedAddresses = new Set<string>()
		for (const genesisOutcome of ['yes', 'no'] as const) {
			const manifest = await loadManifest(networkId, genesisOutcome)
			if (manifest.network.chainId !== chainId) throw new Error(`The ${networkId} deployment manifest declares chain ${manifest.network.chainId.toString()}, expected ${chainId.toString()}`)
			const plan = buildVerificationPlan(manifest, artifactLookup)
			const jobs = plan.jobs.filter(job => {
				const address = job.address.toLowerCase()
				if (plannedAddresses.has(address)) return false
				plannedAddresses.add(address)
				return true
			})
			console.log(`Verifying ${jobs.length.toString()} ${networkId} ${genesisOutcome} contracts (chain ${chainId.toString()})`)
			for (const skippedStep of plan.skipped) console.log(`  Skipping ${skippedStep.id}: ${skippedStep.reason}`)
			const inputs = await buildStandardJsonInputs()
			for (const target of getExplorerTargets(chainId, environment)) {
				if (target.requiresApiKey && target.apiKey === undefined) {
					console.log(`Skipping ${target.name} on ${networkId}: set ETHERSCAN_API_KEY to verify there.`)
					continue
				}
				console.log(`${target.name} (${target.apiUrl})`)
				const outcomes = await verifyContractsWithExplorer({
					fetchFn: dependencies.fetchFn,
					inputs,
					jobs,
					log: console.log,
					sleep: dependencies.sleep,
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
					fetchFn: dependencies.fetchFn,
					inputs,
					jobs,
					log: console.log,
					sleep: dependencies.sleep,
					target: sourcifyTarget,
				})
				const { failed, summary } = summarizeOutcomes(outcomes)
				console.log(`${sourcifyTarget.name} on ${networkId}: ${summary}`)
				failures += failed
			}
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
