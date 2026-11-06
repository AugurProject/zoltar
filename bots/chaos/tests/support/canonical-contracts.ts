import { MUTATING_CONTRACT_SURFACE, type ContractAbiEntryKind } from '../../src/contracts/surface.ts'

type CanonicalMutatingContractExposure = 'static-endpoint' | 'dynamic-endpoint' | 'deployment-helper' | 'delegate-module' | 'fallback-module' | 'migration-proxy'

interface CanonicalMutatingContract {
	artifactSource: `contracts/${string}.sol`
	contract: string
	exposure: CanonicalMutatingContractExposure
}

// This is the canonical runtime code-family boundary for mutating-surface coverage.
// It contains user-facing protocol endpoints plus deployed factories, workers,
// migration proxies, and storage-coupled delegate modules. Pure/view-only runtime
// helpers, generic Multicall transport, libraries, interfaces, and test contracts
// are deliberately outside this economic-operation manifest.
export const CANONICAL_MUTATING_CONTRACT_MANIFEST: readonly CanonicalMutatingContract[] = [
	{ artifactSource: 'contracts/ZoltarQuestionData.sol', contract: 'ZoltarQuestionData', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/Zoltar.sol', contract: 'Zoltar', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/GenesisReputationToken.sol', contract: 'GenesisReputationToken', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/ReputationToken.sol', contract: 'ReputationToken', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/SecurityPoolFactory.sol', contract: 'SecurityPoolFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/SecurityPoolDeployer.sol', contract: 'SecurityPoolDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/factories/SecurityPoolDeployer.sol', contract: 'SecurityPoolDeploymentWorker', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPool.sol', contract: 'SecurityPool', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolOperationsDelegate.sol', contract: 'SecurityPoolOperationsDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolEventEmitter.sol', contract: 'SecurityPoolEventEmitter', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/OpenOraclePriceCoordinator.sol', contract: 'OpenOraclePriceCoordinator', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SharedPoolPriceFeed.sol', contract: 'SharedPoolPriceFeed', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SharedPoolReportEscrow.sol', contract: 'SharedPoolReportEscrow', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/OpenOracleReportDelegate.sol', contract: 'OpenOracleReportDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/factories/OpenOraclePriceCoordinatorFactory.sol', contract: 'SharedPoolPriceFeedDeploymentWorker', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/OpenOraclePriceCoordinatorFactory.sol', contract: 'OpenOraclePriceCoordinatorFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/factories/OpenOraclePriceCoordinatorFactory.sol', contract: 'PriceCoordinatorDeploymentWorker', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolForker.sol', contract: 'SecurityPoolForker', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolMigrationProxy.sol', contract: 'SecurityPoolMigrationProxy', exposure: 'migration-proxy' },
	{ artifactSource: 'contracts/statoblast/factories/EscalationGameFactory.sol', contract: 'EscalationGameFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/EscalationGame.sol', contract: 'EscalationGame', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/EscalationGameClaimDelegate.sol', contract: 'EscalationGameClaimDelegate', exposure: 'fallback-module' },
	{ artifactSource: 'contracts/statoblast/EscalationGameDepositDelegate.sol', contract: 'EscalationGameDepositDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/factories/ShareTokenFactory.sol', contract: 'ShareTokenFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/tokens/ShareToken.sol', contract: 'ShareToken', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/openOracle/OpenOracle.sol', contract: 'OpenOracle', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/WETH9.sol', contract: 'WETH9', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/trading/TwoWayConstantProductFactory.sol', contract: 'TwoWayConstantProductFactory', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/trading/TwoWayConstantProductPair.sol', contract: 'TwoWayConstantProductPair', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/trading/TwoWayConstantProductRouter.sol', contract: 'TwoWayConstantProductRouter', exposure: 'static-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolCapitalAuctionDelegate.sol', contract: 'SecurityPoolCapitalAuctionDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolCapitalFeeStreams.sol', contract: 'SecurityPoolCapitalFeeStreams', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolCapitalLedger.sol', contract: 'SecurityPoolCapitalLedger', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolCapitalLifecycleDelegate.sol', contract: 'SecurityPoolCapitalLifecycleDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolCommitmentIndex.sol', contract: 'SecurityPoolCommitmentIndex', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolForkerPortfolioDelegate.sol', contract: 'SecurityPoolForkerPortfolioDelegate', exposure: 'delegate-module' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolio.sol', contract: 'SecurityPoolPortfolio', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioAuction.sol', contract: 'SecurityPoolPortfolioAuction', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioAuction.sol', contract: 'SecurityPoolPortfolioAuctionDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioForkCoordinator.sol', contract: 'SecurityPoolPortfolioForkCoordinator', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioForkCoordinator.sol', contract: 'SecurityPoolPortfolioForkCoordinatorDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol', contract: 'SecurityPoolCapitalFeeStreamsDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol', contract: 'SecurityPoolCapitalLedgerDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol', contract: 'SecurityPoolCommitmentIndexDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol', contract: 'SecurityPoolPortfolioServicesDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol', contract: 'SecurityPoolPortfolioSettlementDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol', contract: 'SecurityPoolReporterLedgerDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol', contract: 'SecurityPoolSettlementBookDeployer', exposure: 'deployment-helper' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioServices.sol', contract: 'SecurityPoolPortfolioServices', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolPortfolioSettlement.sol', contract: 'SecurityPoolPortfolioSettlement', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolReporterLedger.sol', contract: 'SecurityPoolReporterLedger', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolSettlementBook.sol', contract: 'SecurityPoolSettlementBook', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolUniformPriceAuction.sol', contract: 'SecurityPoolUniformPriceAuction', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolAuctionVault.sol', contract: 'SecurityPoolAuctionVault', exposure: 'dynamic-endpoint' },
	{ artifactSource: 'contracts/statoblast/SecurityPoolResolutionPremiumBook.sol', contract: 'SecurityPoolResolutionPremiumBook', exposure: 'dynamic-endpoint' },
] as const

export function classifiedMethod(contract: string, method: string, abiEntryKind: ContractAbiEntryKind = 'function') {
	return MUTATING_CONTRACT_SURFACE.find(candidate => candidate.contract === contract && candidate.method === method && candidate.abiEntryKind === abiEntryKind)
}
