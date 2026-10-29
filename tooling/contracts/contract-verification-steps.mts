export type CompilerProfile = 'main' | 'openOracle'

export const SECURITY_POOL_UTILS_SOURCE_PATH = 'contracts/statoblast/SecurityPoolUtils.sol'

type StepDefinition = {
	artifactPath: string
	compilerProfile: CompilerProfile
	contractName: string
	// Source path inside the profile's standard JSON input when it differs
	// from the merged artifact path (the OpenOracle pass compiles under its
	// upstream layout).
	inputPath?: string
	linksLibraries?: boolean
}

export const UNVERIFIABLE_STEPS: Readonly<Record<string, string>> = {
	proxyDeployer: 'raw EVM deterministic proxy with no Solidity source',
}

export const STEP_DEFINITIONS: Readonly<Record<string, StepDefinition>> = {
	deploymentStatusOracle: {
		artifactPath: 'contracts/DeploymentStatusOracle.sol',
		compilerProfile: 'main',
		contractName: 'DeploymentStatusOracle',
	},
	weth: {
		artifactPath: 'contracts/statoblast/WETH9.sol',
		compilerProfile: 'main',
		contractName: 'WETH9',
	},
	reputationToken: {
		artifactPath: 'contracts/GenesisReputationToken.sol',
		compilerProfile: 'main',
		contractName: 'GenesisReputationToken',
	},
	multicall3: {
		artifactPath: 'contracts/statoblast/Multicall3.sol',
		compilerProfile: 'main',
		contractName: 'Multicall3',
	},
	zoltarQuestionData: {
		artifactPath: 'contracts/ZoltarQuestionData.sol',
		compilerProfile: 'main',
		contractName: 'ZoltarQuestionData',
	},
	zoltar: {
		artifactPath: 'contracts/Zoltar.sol',
		compilerProfile: 'main',
		contractName: 'Zoltar',
	},
	uniformPriceDualCapBatchAuctionFactory: {
		artifactPath: 'contracts/statoblast/factories/UniformPriceDualCapBatchAuctionFactory.sol',
		compilerProfile: 'main',
		contractName: 'UniformPriceDualCapBatchAuctionFactory',
	},
	securityPoolUtils: {
		artifactPath: SECURITY_POOL_UTILS_SOURCE_PATH,
		compilerProfile: 'main',
		contractName: 'SecurityPoolUtils',
	},
	securityPoolCapitalLedgerDeployer: {
		artifactPath: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolCapitalLedgerDeployer',
	},
	securityPoolCommitmentIndexDeployer: {
		artifactPath: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolCommitmentIndexDeployer',
	},
	securityPoolCapitalFeeStreamsDeployer: {
		artifactPath: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolCapitalFeeStreamsDeployer',
	},
	securityPoolSettlementBookDeployer: {
		artifactPath: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolSettlementBookDeployer',
	},
	securityPoolPortfolioSettlementDeployer: {
		artifactPath: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolPortfolioSettlementDeployer',
	},
	securityPoolPortfolioServicesDeployer: {
		artifactPath: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolPortfolioServicesDeployer',
	},
	securityPoolReporterLedgerDeployer: {
		artifactPath: 'contracts/statoblast/SecurityPoolPortfolioModuleDeployers.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolReporterLedgerDeployer',
	},
	securityPoolPortfolioForkCoordinatorDeployer: {
		artifactPath: 'contracts/statoblast/SecurityPoolPortfolioForkCoordinator.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolPortfolioForkCoordinatorDeployer',
	},
	securityPoolPortfolioAuctionDeployer: {
		artifactPath: 'contracts/statoblast/SecurityPoolPortfolioAuction.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolPortfolioAuctionDeployer',
	},
	securityPoolEventEmitter: {
		artifactPath: 'contracts/statoblast/SecurityPoolEventEmitter.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolEventEmitter',
		linksLibraries: true,
	},
	securityPoolOperationsDelegate: {
		artifactPath: 'contracts/statoblast/SecurityPoolOperationsDelegate.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolOperationsDelegate',
		linksLibraries: true,
	},
	openOracle: {
		artifactPath: 'contracts/statoblast/openOracle/OpenOracle.sol',
		compilerProfile: 'openOracle',
		contractName: 'OpenOracle',
		inputPath: 'src/OpenOracleSlim.sol',
	},
	shareTokenFactory: {
		artifactPath: 'contracts/statoblast/factories/ShareTokenFactory.sol',
		compilerProfile: 'main',
		contractName: 'ShareTokenFactory',
	},
	priceCoordinatorDeploymentWorker: {
		artifactPath: 'contracts/statoblast/factories/OpenOraclePriceCoordinatorFactory.sol',
		compilerProfile: 'main',
		contractName: 'PriceCoordinatorDeploymentWorker',
		linksLibraries: true,
	},
	sharedPoolPriceFeedDeploymentWorker: {
		artifactPath: 'contracts/statoblast/factories/OpenOraclePriceCoordinatorFactory.sol',
		compilerProfile: 'main',
		contractName: 'SharedPoolPriceFeedDeploymentWorker',
		linksLibraries: true,
	},
	openOraclePriceCoordinatorFactory: {
		artifactPath: 'contracts/statoblast/factories/OpenOraclePriceCoordinatorFactory.sol',
		compilerProfile: 'main',
		contractName: 'OpenOraclePriceCoordinatorFactory',
		linksLibraries: true,
	},
	securityPoolForkerPortfolioDelegate: {
		artifactPath: 'contracts/statoblast/SecurityPoolForkerPortfolioDelegate.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolForkerPortfolioDelegate',
		linksLibraries: true,
	},
	securityPoolForker: {
		artifactPath: 'contracts/statoblast/SecurityPoolForker.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolForker',
		linksLibraries: true,
	},
	escalationGameClaimDelegate: {
		artifactPath: 'contracts/statoblast/EscalationGameClaimDelegate.sol',
		compilerProfile: 'main',
		contractName: 'EscalationGameClaimDelegate',
	},
	escalationGameDepositDelegate: {
		artifactPath: 'contracts/statoblast/EscalationGameDepositDelegate.sol',
		compilerProfile: 'main',
		contractName: 'EscalationGameDepositDelegate',
	},
	escalationGameFactory: {
		artifactPath: 'contracts/statoblast/factories/EscalationGameFactory.sol',
		compilerProfile: 'main',
		contractName: 'EscalationGameFactory',
	},
	securityPoolFactory: {
		artifactPath: 'contracts/statoblast/factories/SecurityPoolFactory.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolFactory',
		linksLibraries: true,
	},
}
