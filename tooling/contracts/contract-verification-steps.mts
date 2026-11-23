export type CompilerProfile = 'main' | 'openOracle'

type StepDefinition = {
	artifactPath: string
	compilerProfile: CompilerProfile
	contractName: string
	// Source path inside the profile's standard JSON input when it differs
	// from the merged artifact path (the OpenOracle pass compiles under its
	// upstream layout).
	inputPath?: string
}

// Manifest derivedContracts that no proxy-deployer step creates. Each is
// created with CREATE by another deployed contract's constructor, so its
// address is the creator's CREATE address at the given nonce.
export const CREATE_DERIVED_CONTRACTS: Readonly<Record<string, StepDefinition & { createdBy: string; createNonce: bigint }>> = {
	escalationGameProofVerifier: {
		artifactPath: 'contracts/statoblast/EscalationGameProofVerifier.sol',
		compilerProfile: 'main',
		contractName: 'EscalationGameProofVerifier',
		createdBy: 'escalationGameFactory',
		createNonce: 1n,
	},
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
	},
	securityPoolOperationsDelegate: {
		artifactPath: 'contracts/statoblast/SecurityPoolOperationsDelegate.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolOperationsDelegate',
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
	},
	sharedPoolPriceFeedDeploymentWorker: {
		artifactPath: 'contracts/statoblast/factories/OpenOraclePriceCoordinatorFactory.sol',
		compilerProfile: 'main',
		contractName: 'SharedPoolPriceFeedDeploymentWorker',
	},
	openOraclePriceCoordinatorFactory: {
		artifactPath: 'contracts/statoblast/factories/OpenOraclePriceCoordinatorFactory.sol',
		compilerProfile: 'main',
		contractName: 'OpenOraclePriceCoordinatorFactory',
	},
	securityPoolForkerPortfolioDelegate: {
		artifactPath: 'contracts/statoblast/SecurityPoolForkerPortfolioDelegate.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolForkerPortfolioDelegate',
	},
	securityPoolForker: {
		artifactPath: 'contracts/statoblast/SecurityPoolForker.sol',
		compilerProfile: 'main',
		contractName: 'SecurityPoolForker',
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
	},
}
