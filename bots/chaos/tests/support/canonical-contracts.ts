import { MUTATING_CONTRACT_SURFACE, type ContractAbiEntryKind } from '../../src/contracts/surface.ts'

type CanonicalMutatingContractExposure = 'static-endpoint' | 'dynamic-endpoint' | 'deployment-helper' | 'delegate-module' | 'fallback-module'

interface CanonicalMutatingContract {
	artifactSource: `contracts/${string}.sol`
	contract: string
	exposure: CanonicalMutatingContractExposure
}

// This is the canonical runtime code-family boundary for mutating-surface coverage.
// It contains user-facing protocol endpoints plus deployed factories, workers,
// and storage-coupled delegate modules. Pure/view-only runtime
// helpers, generic Multicall transport, libraries, interfaces, and test contracts
// are deliberately outside this economic-operation manifest.
export const CANONICAL_MUTATING_CONTRACT_MANIFEST: readonly CanonicalMutatingContract[] = [
	{ artifactSource: 'contracts/ZoltarQuestionData.sol', contract: 'ZoltarQuestionData', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/Zoltar.sol', contract: 'Zoltar', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/GenesisReputationToken.sol', contract: 'GenesisReputationToken', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/ReputationToken.sol', contract: 'ReputationToken', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/SecurityPoolFactory.sol', contract: 'SecurityPoolFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/QuestionLedgerDeployer.sol', contract: 'QuestionLedgerDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/factories/QuestionLedgerDeployer.sol', contract: 'QuestionLedgerDeploymentWorker', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/QuestionLedger.sol', contract: 'QuestionLedger', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/QuestionLedgerOperationsDelegate.sol', contract: 'QuestionLedgerOperationsDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/QuestionLedgerAccountingModule.sol', contract: 'QuestionLedgerAccountingModule', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/SharedPoolPriceFeed.sol', contract: 'SharedPoolPriceFeed', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SharedPoolReportEscrow.sol', contract: 'SharedPoolReportEscrow', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/SharedPoolPriceFeedFactory.sol', contract: 'SharedPoolPriceFeedDeploymentWorker', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/SharedPoolPriceFeedFactory.sol', contract: 'SharedPoolPriceFeedFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/QuestionForker.sol', contract: 'QuestionForker', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/EscalationGameFactory.sol', contract: 'EscalationGameFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/EscalationGame.sol', contract: 'EscalationGame', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/EscalationGameDepositDelegate.sol', contract: 'EscalationGameDepositDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/factories/ShareTokenFactory.sol', contract: 'ShareTokenFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/tokens/ShareToken.sol', contract: 'ShareToken', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/openOracle/OpenOracle.sol', contract: 'OpenOracle', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/WETH9.sol', contract: 'WETH9', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/trading/TwoWayConstantProductFactory.sol', contract: 'TwoWayConstantProductFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/trading/TwoWayConstantProductPair.sol', contract: 'TwoWayConstantProductPair', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/trading/TwoWayConstantProductRouter.sol', contract: 'TwoWayConstantProductRouter', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolCapitalRepairAuctionDelegate.sol', contract: 'SecurityPoolCapitalRepairAuctionDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolCapitalFeeStreams.sol', contract: 'SecurityPoolCapitalFeeStreams', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolCapitalLedger.sol', contract: 'SecurityPoolCapitalLedger', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolCapitalLifecycleDelegate.sol', contract: 'SecurityPoolCapitalLifecycleDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolCommitmentIndex.sol', contract: 'SecurityPoolCommitmentIndex', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/QuestionForkerDelegate.sol', contract: 'QuestionForkerDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/SecurityPool.sol', contract: 'SecurityPool', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolRepairAuction.sol', contract: 'SecurityPoolRepairAuction', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolRepairAuction.sol', contract: 'SecurityPoolRepairAuctionDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolForkCoordinator.sol', contract: 'SecurityPoolForkCoordinator', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolForkCoordinator.sol', contract: 'SecurityPoolForkCoordinatorDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolModuleDeployers.sol', contract: 'SecurityPoolCapitalFeeStreamsDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolModuleDeployers.sol', contract: 'SecurityPoolCapitalLedgerDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolModuleDeployers.sol', contract: 'SecurityPoolCommitmentIndexDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolModuleDeployers.sol', contract: 'SecurityPoolServicesDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolModuleDeployers.sol', contract: 'SecurityPoolSettlementDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolModuleDeployers.sol', contract: 'SecurityPoolReporterLedgerDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolModuleDeployers.sol', contract: 'SecurityPoolSettlementBookDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolServices.sol', contract: 'SecurityPoolServices', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolSettlement.sol', contract: 'SecurityPoolSettlement', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolReporterLedger.sol', contract: 'SecurityPoolReporterLedger', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolSettlementBook.sol', contract: 'SecurityPoolSettlementBook', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolUniformPriceRepairAuction.sol', contract: 'SecurityPoolUniformPriceRepairAuction', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolRepairAuctionVault.sol', contract: 'SecurityPoolRepairAuctionVault', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolResolutionPremiumBook.sol', contract: 'SecurityPoolResolutionPremiumBook', exposure: 'dynamic-endpoint' },
] as const

export function classifiedMethod(contract: string, method: string, abiEntryKind: ContractAbiEntryKind = 'function') {
	return MUTATING_CONTRACT_SURFACE.find(candidate => candidate.contract === contract && candidate.method === method && candidate.abiEntryKind === abiEntryKind)
}
