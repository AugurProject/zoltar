import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Emits the repository-contract ABIs the bots consume from the compiled artifact into bots/shared instead of hand-maintained
 * per-bot copies. Every export is the complete artifact ABI of one contract (optionally composed with functions a proxy
 * exposes through a delegate) or one named event, so the bots always match the deployed interface and the conformance tests
 * only need to check identity.
 */
const repositoryRoot = path.resolve(import.meta.dir, '..', '..')
const artifactPath = path.join(repositoryRoot, 'solidity', 'artifacts', 'Contracts.json')

type ContractSelection = { readonly artifactSource: string; readonly contract: string; readonly functions?: readonly string[] }
type AbiExport = { readonly name: string; readonly sources: readonly ContractSelection[] } | { readonly name: string; readonly source: ContractSelection; readonly event: string }

const statoblast = (contract: string, functions?: readonly string[]): ContractSelection => ({ artifactSource: `contracts/statoblast/${contract}.sol`, contract: contract.split('/').at(-1) ?? contract, ...(functions === undefined ? {} : { functions }) })
const trading = (contract: string): ContractSelection => ({ artifactSource: `contracts/trading/${contract}.sol`, contract })
const root = (contract: string, functions?: readonly string[]): ContractSelection => ({ artifactSource: `contracts/${contract}.sol`, contract, ...(functions === undefined ? {} : { functions }) })
const uniswapSeeder = (contract: string): ContractSelection => ({ artifactSource: 'contracts/chaos/GenesisUniswapV3Seeder.sol', contract })
const escalationGame = [statoblast('EscalationGame'), statoblast('EscalationGameClaimDelegate', ['applyInheritedClaimRetention', 'applyInheritedSourceStorageBasis'])]

/** One generated module in bots/shared serves every bot; names follow the contract names so bots alias locally if they prefer shorter ones. */
const SHARED_ABI_EXPORTS: readonly AbiExport[] = [
	{ name: 'genesisReputationTokenAbi', sources: [root('GenesisReputationToken')] },
	{ name: 'erc20Abi', sources: [root('ReputationToken', ['allowance', 'approve', 'balanceOf', 'decimals', 'name', 'symbol', 'totalSupply', 'transfer', 'transferFrom'])] },
	{ name: 'zoltarAbi', sources: [root('Zoltar')] },
	{ name: 'zoltarQuestionDataAbi', sources: [root('ZoltarQuestionData')] },
	{ name: 'securityPoolFactoryAbi', sources: [statoblast('factories/SecurityPoolFactory')] },
	{ name: 'securityPoolAbi', sources: [statoblast('SecurityPool')] },
	{ name: 'liquidationApprovalRegistryAbi', sources: [statoblast('LiquidationApprovalRegistry')] },
	{ name: 'openOraclePriceCoordinatorAbi', sources: [statoblast('OpenOraclePriceCoordinator')] },
	{ name: 'securityPoolForkerAbi', sources: [statoblast('SecurityPoolForker')] },
	{ name: 'escalationGameAbi', sources: escalationGame },
	{ name: 'uniformPriceDualCapBatchAuctionAbi', sources: [statoblast('UniformPriceDualCapBatchAuction')] },
	{ name: 'openOracleAbi', sources: [statoblast('openOracle/OpenOracle')] },
	{ name: 'weth9Abi', sources: [statoblast('WETH9')] },
	{ name: 'erc1155Abi', sources: [statoblast('tokens/ERC1155')] },
	{ name: 'shareTokenAbi', sources: [statoblast('tokens/ShareToken')] },
	{ name: 'twoWayConstantProductFactoryAbi', sources: [trading('TwoWayConstantProductFactory')] },
	{ name: 'twoWayConstantProductPairAbi', sources: [trading('TwoWayConstantProductPair')] },
	{ name: 'twoWayConstantProductRouterAbi', sources: [trading('TwoWayConstantProductRouter')] },
	{ name: 'genesisUniswapV3SeederAbi', sources: [uniswapSeeder('GenesisUniswapV3Seeder')] },
	{ name: 'genesisUniswapV3FactoryAbi', sources: [uniswapSeeder('IGenesisUniswapV3Factory')] },
	{ name: 'genesisUniswapV3PoolStateAbi', sources: [uniswapSeeder('IGenesisUniswapV3PoolState')] },
	{ name: 'deploySecurityPoolEvent', source: statoblast('factories/SecurityPoolFactory'), event: 'DeploySecurityPool' },
	{ name: 'vaultAccountingCheckpointEvent', source: statoblast('SecurityPool'), event: 'VaultAccountingCheckpoint' },
	{ name: 'vaultEscrowUpdatedEvent', source: statoblast('EscalationGame'), event: 'VaultEscrowUpdated' },
	{ name: 'truthAuctionHaircutAppliedEvent', source: statoblast('EscalationGame'), event: 'TruthAuctionHaircutApplied' },
]
const outputPath = path.join(repositoryRoot, 'bots', 'shared', 'src', 'contracts', 'abi.generated.ts')

type AbiItem = { readonly type: string; readonly name: string | undefined; readonly entry: Record<string, unknown> }

function record(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} is not an object`)
	return Object.fromEntries(Object.entries(value))
}

function contractAbi(contracts: Record<string, unknown>, selection: ContractSelection): readonly AbiItem[] {
	const abi = record(record(contracts[selection.artifactSource], selection.artifactSource)[selection.contract], `${selection.artifactSource}.${selection.contract}`)['abi']
	if (!Array.isArray(abi)) throw new Error(`${selection.contract} artifact ABI is missing`)
	const items = abi.map((item, index) => {
		const entry = record(item, `${selection.contract}.abi[${index.toString()}]`)
		const type = entry['type']
		if (typeof type !== 'string') throw new Error(`${selection.contract}.abi[${index.toString()}] has no type`)
		const name = entry['name']
		return { entry, name: typeof name === 'string' ? name : undefined, type }
	})
	if (selection.functions === undefined) return items
	const wanted = new Set(selection.functions)
	const selected = items.filter(item => item.type === 'function' && item.name !== undefined && wanted.has(item.name))
	for (const name of wanted) if (!selected.some(item => item.name === name)) throw new Error(`${selection.contract} artifact ABI has no function ${name}`)
	return selected
}

function renderExport(contracts: Record<string, unknown>, abiExport: AbiExport): string {
	if ('event' in abiExport) {
		const event = contractAbi(contracts, abiExport.source).find(item => item.type === 'event' && item.name === abiExport.event)
		if (event === undefined) throw new Error(`${abiExport.source.contract} artifact ABI has no event ${abiExport.event}`)
		return `export const ${abiExport.name} = ${JSON.stringify(event.entry)} as const\n`
	}
	return `export const ${abiExport.name} = ${JSON.stringify(abiExport.sources.flatMap(source => contractAbi(contracts, source).map(item => item.entry)))} as const\n`
}

async function renderSharedAbis(contracts: Record<string, unknown>): Promise<string> {
	const unformatted = `// Generated by tooling/contracts/generate-bot-abis.mts from solidity/artifacts/Contracts.json. Do not edit.\n${SHARED_ABI_EXPORTS.map(abiExport => renderExport(contracts, abiExport)).join('\n')}`
	const formatter = Bun.spawnSync(['bunx', '@biomejs/biome', 'format', '--stdin-file-path', outputPath], { cwd: repositoryRoot, stderr: 'pipe', stdin: Buffer.from(unformatted), stdout: 'pipe' })
	if (!formatter.success) throw new Error(`Could not format the generated bot ABIs: ${formatter.stderr.toString()}`)
	return formatter.stdout.toString()
}

if (import.meta.main) {
	const contracts = record(record(JSON.parse(await readFile(artifactPath, 'utf8')), 'artifact document')['contracts'], 'artifact contracts')
	const generated = await renderSharedAbis(contracts)
	if (process.argv.includes('--check')) {
		const current = await readFile(outputPath, 'utf8').catch(() => undefined)
		if (current !== generated) throw new Error(`${path.relative(repositoryRoot, outputPath)} is stale; run bun tooling/contracts/generate-bot-abis.mts`)
	} else await Bun.write(outputPath, generated)
}
