import { describe, expect, test } from 'bun:test'
import * as abis from '../src/contracts/abi.generated.ts'
import {
	chaos_GenesisUniswapV3Seeder_GenesisUniswapV3Seeder,
	chaos_GenesisUniswapV3Seeder_IGenesisUniswapV3Factory,
	chaos_GenesisUniswapV3Seeder_IGenesisUniswapV3PoolState,
	GenesisReputationToken_GenesisReputationToken,
	ReputationToken_ReputationToken,
	statoblast_EscalationGame_EscalationGame,
	statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry,
	statoblast_Multicall3_Multicall3,
	statoblast_openOracle_OpenOracle_OpenOracle,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed,
	statoblast_SecurityPool_SecurityPool,
	statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate,
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger,
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuction,
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault,
	statoblast_tokens_ERC1155_ERC1155,
	statoblast_tokens_ShareToken_ShareToken,
	statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	statoblast_WETH9_WETH9,
	trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory,
	trading_TwoWayConstantProductPair_TwoWayConstantProductPair,
	trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter,
	Zoltar_Zoltar,
	ZoltarQuestionData_ZoltarQuestionData,
} from '../../../solidity/ts/types/contractArtifact.ts'

const items = (abi: readonly unknown[]): readonly unknown[] => abi
const event = (abi: readonly { type: string; name?: string }[], name: string): unknown => abi.find(item => item.type === 'event' && item.name === name)
const generated = (value: unknown): unknown => value
const delegatedEscalationGameFunctions = new Set(['getInheritedClaimAllocation', 'getClaimCheckpointProgress', 'getClaimCheckpointState', 'getClaimCheckpointWitnessSegment', 'getClaimIntervalTransform', 'isClaimHistoryFrozen', 'processClaimCheckpoint'])
const erc20Functions = new Set(['allowance', 'approve', 'balanceOf', 'decimals', 'name', 'symbol', 'totalSupply', 'transfer', 'transferFrom'])

describe('generated bot contract ABIs', () => {
	test('every contract ABI is the compiled artifact ABI', () => {
		const expected: readonly [readonly unknown[], readonly unknown[]][] = [
			[abis.genesisReputationTokenAbi, GenesisReputationToken_GenesisReputationToken.abi],
			[abis.zoltarAbi, Zoltar_Zoltar.abi],
			[abis.zoltarQuestionDataAbi, ZoltarQuestionData_ZoltarQuestionData.abi],
			[abis.securityPoolFactoryAbi, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi],
			[abis.securityPoolAbi, [...statoblast_SecurityPool_SecurityPool.abi, ...statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate.abi.filter(item => item.type === 'function' && item.name === 'setVaultUnderwritingLimit')]],
			[abis.liquidationApprovalRegistryAbi, statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi],
			[abis.openOraclePriceCoordinatorAbi, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi],
			[abis.sharedPoolPriceFeedAbi, statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi],
			[abis.securityPoolForkerAbi, statoblast_SecurityPoolForker_SecurityPoolForker.abi],
			[abis.securityPoolCapitalLedgerAbi, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger.abi],
			[abis.securityPoolPortfolioAuctionAbi, statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuction.abi],
			[abis.securityPoolUniformPriceAuctionAbi, statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction.abi],
			[abis.securityPoolAuctionVaultAbi, statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault.abi],
			[abis.uniformPriceDualCapBatchAuctionAbi, statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi],
			[abis.openOracleAbi, statoblast_openOracle_OpenOracle_OpenOracle.abi],
			[abis.weth9Abi, statoblast_WETH9_WETH9.abi],
			[abis.multicall3Abi, statoblast_Multicall3_Multicall3.abi],
			[abis.erc1155Abi, statoblast_tokens_ERC1155_ERC1155.abi],
			[abis.shareTokenAbi, statoblast_tokens_ShareToken_ShareToken.abi],
			[abis.twoWayConstantProductFactoryAbi, trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory.abi],
			[abis.twoWayConstantProductPairAbi, trading_TwoWayConstantProductPair_TwoWayConstantProductPair.abi],
			[abis.twoWayConstantProductRouterAbi, trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter.abi],
			[abis.genesisUniswapV3SeederAbi, chaos_GenesisUniswapV3Seeder_GenesisUniswapV3Seeder.abi],
			[abis.genesisUniswapV3FactoryAbi, chaos_GenesisUniswapV3Seeder_IGenesisUniswapV3Factory.abi],
			[abis.genesisUniswapV3PoolStateAbi, chaos_GenesisUniswapV3Seeder_IGenesisUniswapV3PoolState.abi],
		]
		for (const [abi, artifact] of expected) expect(items(abi)).toEqual(artifact)
	})

	test('the escalation game ABI composes the proxy artifact with the claim-delegate functions it exposes', () => {
		const delegatedFunctions = statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.abi.filter(item => item.type === 'function' && delegatedEscalationGameFunctions.has(item.name))
		expect(delegatedFunctions).toHaveLength(delegatedEscalationGameFunctions.size)
		expect(items(abis.escalationGameAbi)).toEqual([...statoblast_EscalationGame_EscalationGame.abi, ...delegatedFunctions])
	})

	test('the generic ERC-20 ABI is the standard token surface of the compiled ReputationToken artifact', () => {
		const standard = ReputationToken_ReputationToken.abi.filter(item => item.type === 'function' && erc20Functions.has(item.name))
		expect(standard).toHaveLength(erc20Functions.size)
		expect(items(abis.erc20Abi)).toEqual(standard)
	})

	test('the named events are the compiled artifact events', () => {
		expect(generated(abis.deploySecurityPoolEvent)).toEqual(event(statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, 'DeploySecurityPool'))
		expect(generated(abis.vaultAccountingCheckpointEvent)).toEqual(event(statoblast_SecurityPool_SecurityPool.abi, 'VaultAccountingCheckpoint'))
		expect(generated(abis.vaultEscrowUpdatedEvent)).toEqual(event(statoblast_EscalationGame_EscalationGame.abi, 'VaultEscrowUpdated'))
		expect(generated(abis.ordinarySettlementInitializedEvent)).toEqual(event(statoblast_EscalationGame_EscalationGame.abi, 'OrdinarySettlementInitialized'))
		expect(generated(abis.truthAuctionHaircutAppliedEvent)).toEqual(event(statoblast_EscalationGame_EscalationGame.abi, 'TruthAuctionHaircutApplied'))
	})

	test('every generated export is covered by an artifact assertion', () => {
		const asserted = new Set([
			'genesisReputationTokenAbi',
			'erc20Abi',
			'zoltarAbi',
			'zoltarQuestionDataAbi',
			'securityPoolFactoryAbi',
			'securityPoolAbi',
			'liquidationApprovalRegistryAbi',
			'openOraclePriceCoordinatorAbi',
			'sharedPoolPriceFeedAbi',
			'securityPoolForkerAbi',
			'uniformPriceDualCapBatchAuctionAbi',
			'openOracleAbi',
			'weth9Abi',
			'multicall3Abi',
			'erc1155Abi',
			'shareTokenAbi',
			'twoWayConstantProductFactoryAbi',
			'twoWayConstantProductPairAbi',
			'twoWayConstantProductRouterAbi',
			'genesisUniswapV3SeederAbi',
			'genesisUniswapV3FactoryAbi',
			'genesisUniswapV3PoolStateAbi',
			'escalationGameAbi',
			'deploySecurityPoolEvent',
			'vaultAccountingCheckpointEvent',
			'vaultEscrowUpdatedEvent',
			'ordinarySettlementInitializedEvent',
			'truthAuctionHaircutAppliedEvent',
			'portfolioRuntimeIdentities',
			'securityPoolCapitalLedgerAbi',
			'securityPoolPortfolioAuctionAbi',
			'securityPoolUniformPriceAuctionAbi',
			'securityPoolAuctionVaultAbi',
		])
		expect(Object.keys(abis).sort()).toEqual([...asserted].sort())
	})
})

import { readFile } from 'node:fs/promises'
import { verifyRuntimeIdentity } from '../src/monitoring/runtime-identity.ts'
import { isHex } from '../src/ethereum.ts'

test('portfolio runtime identities authenticate the complete compiled custody tree', async () => {
	const raw: unknown = JSON.parse(await readFile(new URL('../../../solidity/artifacts/Contracts.json', import.meta.url), 'utf8'))
	if (typeof raw !== 'object' || raw === null) throw new Error('Artifact document missing')
	const contracts: unknown = Reflect.get(raw, 'contracts')
	if (typeof contracts !== 'object' || contracts === null) throw new Error('Artifact contracts missing')
	for (const [name, identity] of Object.entries(abis.portfolioRuntimeIdentities)) {
		const source: unknown = Reflect.get(contracts, `contracts/statoblast/${name}.sol`)
		if (typeof source !== 'object' || source === null) throw new Error(`Missing source ${name}`)
		const artifact: unknown = Reflect.get(source, name)
		if (typeof artifact !== 'object' || artifact === null) throw new Error(`Missing artifact ${name}`)
		const evm: unknown = Reflect.get(artifact, 'evm')
		if (typeof evm !== 'object' || evm === null) throw new Error('Missing EVM artifact')
		const deployed: unknown = Reflect.get(evm, 'deployedBytecode')
		if (typeof deployed !== 'object' || deployed === null) throw new Error('Missing deployed artifact')
		const bytecode: unknown = Reflect.get(deployed, 'object')
		const code: `0x${string}` = `0x${String(bytecode)}`
		if (!isHex(code)) throw new Error('Malformed artifact runtime')
		expect(() => verifyRuntimeIdentity(code, identity, name)).not.toThrow()
		expect(identity.immutableReferences).toEqual(Reflect.get(deployed, 'immutableReferences'))
	}
})
