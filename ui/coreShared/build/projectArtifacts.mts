import { promises as fs } from 'fs'
import * as path from 'path'
import * as process from 'node:process'
import * as url from 'node:url'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const UI_ROOT_PATH = path.join(directoryOfThisFile, '..')
const REPOSITORY_ROOT_PATH = path.join(UI_ROOT_PATH, '..', '..')
const ABI_OUTPUT_PATH = path.join(UI_ROOT_PATH, 'ts', 'abis.ts')
const ABI_SOURCE_PATH = path.join(REPOSITORY_ROOT_PATH, 'solidity', 'ts', 'abi', 'abis.ts')
const CONTRACT_ARTIFACT_OUTPUT_PATH = path.join(UI_ROOT_PATH, 'ts', 'contractArtifact.ts')
const CONTRACT_ARTIFACTS_JSON_PATH = path.join(REPOSITORY_ROOT_PATH, 'solidity', 'artifacts', 'Contracts.json')
const TRADING_CONTRACT_ARTIFACT_OUTPUT_PATH = path.join(UI_ROOT_PATH, '..', 'trading', 'ts', 'generated', 'contractArtifact.ts')

type CompiledContract = {
	readonly abi?: unknown
	readonly evm?: unknown
}

type CompiledContractsJson = {
	readonly contracts?: Record<string, Record<string, CompiledContract | undefined> | undefined>
}

export async function copyProjectArtifacts() {
	const solidityAbiSource = await fs.readFile(ABI_SOURCE_PATH, 'utf8')
	await fs.writeFile(ABI_OUTPUT_PATH, solidityAbiSource)

	const compiledArtifacts = JSON.parse(await fs.readFile(CONTRACT_ARTIFACTS_JSON_PATH, 'utf8')) as CompiledContractsJson
	if (compiledArtifacts.contracts === undefined) throw new Error('No compiled contracts found in Contracts.json')

	const contracts = Object.entries(compiledArtifacts.contracts).flatMap(([filename, contractFile]) => {
		if (contractFile === undefined) throw new Error(`missing compiled contract file for ${filename}`)
		return Object.entries(contractFile).map(([contractName, contractData]) => {
			if (contractData === undefined) throw new Error(`missing compiled contract ${contractName} in ${filename}`)
			const normalizedName = `${filename
				.replace('contracts/', '')
				.replace(/-/g, '')
				.replace(/\//g, '_')
				.replace(/\\/g, '_')
				.replace(/\.sol$/, '')}_${contractName}`
			return `export const ${normalizedName} = ${JSON.stringify(contractData, null, 4)} as const`
		})
	})

	await fs.writeFile(CONTRACT_ARTIFACT_OUTPUT_PATH, `${contracts.join('\n\n')}\n`)

	const tradingContracts = Object.fromEntries(Object.entries(compiledArtifacts.contracts).filter(([filename]) => filename.startsWith('contracts/trading/')))
	await fs.mkdir(path.dirname(TRADING_CONTRACT_ARTIFACT_OUTPUT_PATH), { recursive: true })
	await fs.writeFile(TRADING_CONTRACT_ARTIFACT_OUTPUT_PATH, `// Generated from solidity/artifacts/Contracts.json by ui/coreShared/build/projectArtifacts.mts. Do not edit.\nexport const tradingContracts = ${JSON.stringify(tradingContracts)} as const\n`)
}

const currentScriptPath = url.fileURLToPath(import.meta.url)
const invokedScriptPath = process.argv[1]

if (invokedScriptPath !== undefined && path.resolve(invokedScriptPath) === currentScriptPath) {
	copyProjectArtifacts().catch(error => {
		console.error(error)
		process.exit(1)
	})
}
