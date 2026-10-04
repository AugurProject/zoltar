import { CANONICAL_TRADING_FEE_BPS, tradingDeploymentData } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory, trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter } from '../../../../../solidity/ts/types/contractArtifact.ts'
import { CANONICAL_PROXY_DEPLOYER } from '../../core/genesis-uniswap.ts'
import { eligible, planBase } from '../planning.ts'
import type { OperationDefinition, OperationEvidence } from '../types.ts'

export function deploymentStep(id: string, label: string, to: Address, data: Hex, evidence: OperationEvidence[]) {
	return { data, evidence, gasLimit: '12000000', id, label, preflightCalls: [], to, walletAssetDebits: [] }
}

export function tradingRootDeploymentPlans(securityPoolFactory: Address) {
	return tradingDeploymentData(
		CANONICAL_PROXY_DEPLOYER,
		securityPoolFactory,
		CANONICAL_TRADING_FEE_BPS,
		{ abi: trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory.abi, bytecode: `0x${trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory.evm.bytecode.object}` },
		{ abi: trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter.abi, bytecode: `0x${trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter.evm.bytecode.object}` },
	)
}

export const deployTradingFactory: OperationDefinition = {
	buildPlan(snapshot) {
		const deployment = tradingRootDeploymentPlans(snapshot.deployments.securityPoolFactory)
		if (deployment.factoryAddress !== snapshot.deployments.tradingFactory) return undefined
		return planBase({
			definitionId: deployTradingFactory.id,
			ecosystem: 'trading',
			label: deployTradingFactory.label,
			metadata: { factory: deployment.factoryAddress },
			postconditions: ['The deterministic trading factory references the configured SecurityPoolFactory'],
			risk: 'medium',
			snapshot,
			steps: [
				deploymentStep('deploy-trading-factory', 'Deploy trading factory', CANONICAL_PROXY_DEPLOYER, deployment.factoryData, [
					{ abi: 'function securityPoolFactory() view returns (address)', args: [], contract: deployment.factoryAddress, expected: snapshot.deployments.securityPoolFactory, functionName: 'securityPoolFactory', kind: 'storage-postcondition', relation: 'equals' },
				]),
			],
		})
	},
	classification: 'selectable',
	contract: 'TwoWayConstantProductFactory',
	description: 'Deterministically deploys the configured trading factory through the authenticated canonical proxy deployer.',
	discoveryInputs: ['configured trading roots and canonical proxy deployment'],
	ecosystem: 'trading',
	evaluate(snapshot) {
		const deployment = tradingRootDeploymentPlans(snapshot.deployments.securityPoolFactory)
		return eligible(snapshot.tradingDeployment?.factory === false ? undefined : 'Trading factory is already deployed', deployment.factoryAddress === snapshot.deployments.tradingFactory ? undefined : 'Configured trading factory does not match the deterministic deployment plan')
	},
	id: 'trading.root.deploy-factory',
	label: 'Deploy trading factory',
	method: 'fallback',
	risk: 'medium',
}

export const deployTradingRouter: OperationDefinition = {
	buildPlan(snapshot) {
		const deployment = tradingRootDeploymentPlans(snapshot.deployments.securityPoolFactory)
		if (deployment.routerAddress !== snapshot.deployments.tradingRouter) return undefined
		return planBase({
			definitionId: deployTradingRouter.id,
			ecosystem: 'trading',
			label: deployTradingRouter.label,
			metadata: { router: deployment.routerAddress },
			postconditions: ['The deterministic trading router references the configured trading factory'],
			risk: 'medium',
			snapshot,
			steps: [
				deploymentStep('deploy-trading-router', 'Deploy trading router', CANONICAL_PROXY_DEPLOYER, deployment.routerData, [
					{ abi: 'function factory() view returns (address)', args: [], contract: deployment.routerAddress, expected: snapshot.deployments.tradingFactory, functionName: 'factory', kind: 'storage-postcondition', relation: 'equals' },
				]),
			],
		})
	},
	classification: 'selectable',
	contract: 'TwoWayConstantProductRouter',
	description: 'Deterministically deploys the configured trading router through the authenticated canonical proxy deployer.',
	discoveryInputs: ['configured trading roots and canonical proxy deployment'],
	ecosystem: 'trading',
	evaluate(snapshot) {
		const deployment = tradingRootDeploymentPlans(snapshot.deployments.securityPoolFactory)
		return eligible(
			snapshot.tradingDeployment?.factory === true ? undefined : 'Deploy the trading factory first',
			snapshot.tradingDeployment?.router === false ? undefined : 'Trading router is already deployed',
			deployment.routerAddress === snapshot.deployments.tradingRouter ? undefined : 'Configured trading router does not match the deterministic deployment plan',
		)
	},
	id: 'trading.root.deploy-router',
	label: 'Deploy trading router',
	method: 'fallback',
	risk: 'medium',
}
