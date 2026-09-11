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
	statoblast_openOracle_OpenOracle_OpenOracle,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	statoblast_SecurityPool_SecurityPool,
	statoblast_SecurityPoolForker_SecurityPoolForker,
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
const delegatedEscalationGameViews = new Set(['applyInheritedClaimRetention', 'applyInheritedSourceStorageBasis'])

describe('generated bot contract ABIs', () => {
	test('every contract ABI is the compiled artifact ABI', () => {
		const expected: readonly [readonly unknown[], readonly unknown[]][] = [
			[abis.genesisReputationTokenAbi, GenesisReputationToken_GenesisReputationToken.abi],
			[abis.reputationTokenAbi, ReputationToken_ReputationToken.abi],
			[abis.zoltarAbi, Zoltar_Zoltar.abi],
			[abis.zoltarQuestionDataAbi, ZoltarQuestionData_ZoltarQuestionData.abi],
			[abis.securityPoolFactoryAbi, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi],
			[abis.securityPoolAbi, statoblast_SecurityPool_SecurityPool.abi],
			[abis.liquidationApprovalRegistryAbi, statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi],
			[abis.openOraclePriceCoordinatorAbi, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi],
			[abis.securityPoolForkerAbi, statoblast_SecurityPoolForker_SecurityPoolForker.abi],
			[abis.uniformPriceDualCapBatchAuctionAbi, statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi],
			[abis.openOracleAbi, statoblast_openOracle_OpenOracle_OpenOracle.abi],
			[abis.weth9Abi, statoblast_WETH9_WETH9.abi],
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

	test('the escalation game ABI composes the proxy artifact with the claim-delegate views it exposes', () => {
		const delegatedViews = statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.abi.filter(item => item.type === 'function' && delegatedEscalationGameViews.has(item.name))
		expect(delegatedViews).toHaveLength(delegatedEscalationGameViews.size)
		expect(items(abis.escalationGameAbi)).toEqual([...statoblast_EscalationGame_EscalationGame.abi, ...delegatedViews])
	})

	test('the named events are the compiled artifact events', () => {
		expect(generated(abis.deploySecurityPoolEvent)).toEqual(event(statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, 'DeploySecurityPool'))
		expect(generated(abis.vaultAccountingCheckpointEvent)).toEqual(event(statoblast_SecurityPool_SecurityPool.abi, 'VaultAccountingCheckpoint'))
		expect(generated(abis.vaultEscrowUpdatedEvent)).toEqual(event(statoblast_EscalationGame_EscalationGame.abi, 'VaultEscrowUpdated'))
		expect(generated(abis.truthAuctionHaircutAppliedEvent)).toEqual(event(statoblast_EscalationGame_EscalationGame.abi, 'TruthAuctionHaircutApplied'))
	})

	test('every generated export is covered by an artifact assertion', () => {
		const asserted = new Set([
			'genesisReputationTokenAbi',
			'reputationTokenAbi',
			'zoltarAbi',
			'zoltarQuestionDataAbi',
			'securityPoolFactoryAbi',
			'securityPoolAbi',
			'liquidationApprovalRegistryAbi',
			'openOraclePriceCoordinatorAbi',
			'securityPoolForkerAbi',
			'uniformPriceDualCapBatchAuctionAbi',
			'openOracleAbi',
			'weth9Abi',
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
			'truthAuctionHaircutAppliedEvent',
		])
		expect(Object.keys(abis).sort()).toEqual([...asserted].sort())
	})
})
