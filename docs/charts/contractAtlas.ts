import { contractAtlasSourceReferences } from './contractAtlasSourceReferences'

export type ContractAtlasKind = 'abstract' | 'contract' | 'interface' | 'library' | 'module'

export type ContractAtlasPanel = 'infrastructure' | 'statoblast-deployment' | 'statoblast-implementation' | 'statoblast-runtime' | 'tests' | 'zoltar'

export type ContractAtlasRelation = 'assets' | 'calls' | 'compatible' | 'delegatecall' | 'deploys' | 'implements' | 'inherits' | 'references' | 'tests' | 'uses'

export type ContractAtlasNode = {
	column: number
	declaration?: string
	id: string
	kind: ContractAtlasKind
	label: string
	order: number
	panel: ContractAtlasPanel
	source: string
}

export type ContractAtlasEdge = {
	description: string
	id: string
	relation: ContractAtlasRelation
	source: string
	target: string
}

export type ContractAtlasPlotRoute = {
	edges: ContractAtlasEdge[]
	id: string
	source: string
	target: string
}

function node(id: string, label: string, kind: ContractAtlasKind, panel: ContractAtlasPanel, column: number, order: number, source: string, declaration = label): ContractAtlasNode {
	return {
		column,
		...(kind === 'module' ? {} : { declaration }),
		id,
		kind,
		label,
		order,
		panel,
		source,
	}
}

function edge(id: string, source: string, target: string, relation: ContractAtlasRelation, description: string): ContractAtlasEdge {
	return { description, id, relation, source, target }
}

export const contractAtlasRelationLabels: Record<ContractAtlasRelation, string> = {
	assets: 'asset-bearing call',
	calls: 'runtime call',
	compatible: 'structural compatibility',
	delegatecall: 'delegatecall',
	deploys: 'deployment',
	implements: 'implements',
	inherits: 'inherits',
	references: 'direct source reference',
	tests: 'test-only exercise',
	uses: 'library or type use',
}

export const contractAtlasNodes: ContractAtlasNode[] = [
	// Zoltar is intentionally its own region: it owns questions, universes, and REP.
	node('zoltar-constants', 'Constants', 'library', 'zoltar', 0, 0, 'solidity/contracts/Constants.sol'),
	node('zoltar-context', 'Context', 'abstract', 'zoltar', 0, 1, 'solidity/contracts/Context.sol'),
	node('zoltar-ierc20', 'IERC20', 'interface', 'zoltar', 0, 2, 'solidity/contracts/IERC20.sol'),
	node('zoltar-ierc20-metadata', 'IERC20Metadata', 'interface', 'zoltar', 0, 3, 'solidity/contracts/IERC20Metadata.sol'),
	node('zoltar-safe-erc20-ops', 'SafeERC20Ops', 'library', 'zoltar', 0, 4, 'solidity/contracts/SafeERC20Ops.sol'),
	node('zoltar-scalar-outcomes', 'ScalarOutcomes', 'library', 'zoltar', 0, 5, 'solidity/contracts/ScalarOutcomes.sol'),
	node('zoltar-erc20', 'ERC20', 'abstract', 'zoltar', 1, 1, 'solidity/contracts/ERC20.sol'),
	node('zoltar-question-data', 'ZoltarQuestionData', 'contract', 'zoltar', 1, 4, 'solidity/contracts/ZoltarQuestionData.sol'),
	node('zoltar-reputation-token', 'ReputationToken', 'contract', 'zoltar', 2, 1, 'solidity/contracts/ReputationToken.sol'),
	node('zoltar-core', 'Zoltar', 'contract', 'zoltar', 2, 4, 'solidity/contracts/Zoltar.sol'),

	// Statoblast deployment and construction helpers.
	node('statoblast-security-pool-factory', 'SecurityPoolFactory', 'contract', 'statoblast-deployment', 0, 2, 'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol'),
	node('statoblast-share-token-factory', 'ShareTokenFactory', 'contract', 'statoblast-deployment', 1, 0, 'solidity/contracts/peripherals/factories/ShareTokenFactory.sol'),
	node('statoblast-price-coordinator-factory', 'PriceOracleManagerAndOperatorQueuerFactory', 'contract', 'statoblast-deployment', 1, 1, 'solidity/contracts/peripherals/factories/PriceOracleManagerAndOperatorQueuerFactory.sol'),
	node('statoblast-escalation-game-factory', 'EscalationGameFactory', 'contract', 'statoblast-deployment', 1, 2, 'solidity/contracts/peripherals/factories/EscalationGameFactory.sol'),
	node('statoblast-auction-factory', 'UniformPriceDualCapBatchAuctionFactory', 'contract', 'statoblast-deployment', 1, 3, 'solidity/contracts/peripherals/factories/UniformPriceDualCapBatchAuctionFactory.sol'),
	node('statoblast-security-pool-deployer', 'SecurityPoolDeployer', 'contract', 'statoblast-deployment', 2, 1, 'solidity/contracts/peripherals/factories/SecurityPoolDeployer.sol'),
	node('statoblast-security-pool-worker', 'SecurityPoolDeploymentWorker', 'contract', 'statoblast-deployment', 3, 1, 'solidity/contracts/peripherals/factories/SecurityPoolDeployer.sol'),

	// Statoblast deployed runtime, fork, delegate, and token contracts.
	node('statoblast-security-pool', 'SecurityPool', 'contract', 'statoblast-runtime', 0, 0, 'solidity/contracts/peripherals/SecurityPool.sol'),
	node('statoblast-share-token', 'ShareToken', 'contract', 'statoblast-runtime', 0, 1, 'solidity/contracts/peripherals/tokens/ShareToken.sol'),
	node('statoblast-price-coordinator', 'OpenOraclePriceCoordinator', 'contract', 'statoblast-runtime', 0, 2, 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol'),
	node('statoblast-escalation-game', 'EscalationGame', 'contract', 'statoblast-runtime', 0, 3, 'solidity/contracts/peripherals/EscalationGame.sol'),
	node('statoblast-pool-forker', 'SecurityPoolForker', 'contract', 'statoblast-runtime', 0, 4, 'solidity/contracts/peripherals/SecurityPoolForker.sol'),
	node('statoblast-truth-auction', 'UniformPriceDualCapBatchAuction', 'contract', 'statoblast-runtime', 0, 5, 'solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol'),
	node('statoblast-erc1155', 'ERC1155', 'contract', 'statoblast-runtime', 1, 0, 'solidity/contracts/peripherals/tokens/ERC1155.sol'),
	node('statoblast-escalation-deposit-delegate', 'EscalationGameDepositDelegate', 'contract', 'statoblast-runtime', 1, 1, 'solidity/contracts/peripherals/EscalationGameDepositDelegate.sol'),
	node('statoblast-escalation-proof-verifier', 'EscalationGameProofVerifier', 'contract', 'statoblast-runtime', 1, 2, 'solidity/contracts/peripherals/EscalationGameProofVerifier.sol'),
	node('statoblast-vault-migration-delegate', 'SecurityPoolForkerVaultMigrationDelegate', 'contract', 'statoblast-runtime', 1, 3, 'solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationDelegate.sol'),
	node('statoblast-escalation-game-forker', 'EscalationGameForker', 'contract', 'statoblast-runtime', 1, 4, 'solidity/contracts/peripherals/EscalationGameForker.sol'),
	node('statoblast-event-emitter', 'SecurityPoolEventEmitter', 'contract', 'statoblast-runtime', 2, 1, 'solidity/contracts/peripherals/SecurityPoolEventEmitter.sol'),
	node('statoblast-migration-proxy', 'SecurityPoolMigrationProxy', 'contract', 'statoblast-runtime', 2, 3, 'solidity/contracts/peripherals/SecurityPoolMigrationProxy.sol'),
	node('statoblast-binary-outcomes', 'BinaryOutcomes', 'library', 'statoblast-runtime', 3, 0, 'solidity/contracts/peripherals/BinaryOutcomes.sol'),
	node('statoblast-merkle-mountain-range', 'MerkleMountainRange', 'library', 'statoblast-runtime', 3, 1, 'solidity/contracts/peripherals/MerkleMountainRange.sol'),
	node('statoblast-security-pool-utils', 'SecurityPoolUtils', 'library', 'statoblast-runtime', 3, 2, 'solidity/contracts/peripherals/SecurityPoolUtils.sol'),
	node('statoblast-token-id', 'TokenId', 'library', 'statoblast-runtime', 3, 3, 'solidity/contracts/peripherals/tokens/TokenId.sol'),

	// Statoblast inheritance stacks, type modules, and contract-facing interfaces.
	node('statoblast-escalation-storage', 'EscalationGameStorage', 'abstract', 'statoblast-implementation', 0, 0, 'solidity/contracts/peripherals/EscalationGameStorage.sol'),
	node('statoblast-escalation-state', 'EscalationGameState', 'abstract', 'statoblast-implementation', 0, 1, 'solidity/contracts/peripherals/EscalationGameState.sol'),
	node('statoblast-escalation-calculations', 'EscalationGameCalculations', 'abstract', 'statoblast-implementation', 0, 2, 'solidity/contracts/peripherals/EscalationGameCalculations.sol'),
	node('statoblast-escalation-carry', 'EscalationGameCarry', 'abstract', 'statoblast-implementation', 0, 3, 'solidity/contracts/peripherals/EscalationGameCarry.sol'),
	node('statoblast-escalation-escrow', 'EscalationGameEscrow', 'abstract', 'statoblast-implementation', 0, 4, 'solidity/contracts/peripherals/EscalationGameEscrow.sol'),
	node('statoblast-escalation-settlement', 'EscalationGameSettlement', 'abstract', 'statoblast-implementation', 0, 5, 'solidity/contracts/peripherals/EscalationGameSettlement.sol'),
	node('statoblast-escalation-types', 'EscalationGameTypes', 'module', 'statoblast-implementation', 0, 6, 'solidity/contracts/peripherals/EscalationGameTypes.sol'),
	node('statoblast-forker-storage', 'SecurityPoolForkerStorage', 'abstract', 'statoblast-implementation', 1, 0, 'solidity/contracts/peripherals/SecurityPoolForkerStorage.sol'),
	node('statoblast-forker-base', 'SecurityPoolForkerBase', 'abstract', 'statoblast-implementation', 1, 1, 'solidity/contracts/peripherals/SecurityPoolForkerBase.sol'),
	node('statoblast-vault-migration-base', 'SecurityPoolForkerVaultMigrationBase', 'abstract', 'statoblast-implementation', 1, 2, 'solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol'),
	node('statoblast-forker-types', 'SecurityPoolForkerTypes', 'module', 'statoblast-implementation', 1, 3, 'solidity/contracts/peripherals/SecurityPoolForkerTypes.sol'),
	node('statoblast-escalation-deposit-context', 'IEscalationGameDepositContext', 'interface', 'statoblast-implementation', 2, 0, 'solidity/contracts/peripherals/EscalationGameDepositDelegate.sol'),
	node('statoblast-stored-open-oracle-game', 'IStoredOpenOracleGame', 'interface', 'statoblast-implementation', 2, 1, 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol'),
	node('statoblast-deployment-worker-config', 'ISecurityPoolDeploymentWorkerConfiguration', 'interface', 'statoblast-implementation', 2, 2, 'solidity/contracts/peripherals/SecurityPool.sol'),
	node('statoblast-iaugur', 'IAugur', 'interface', 'statoblast-implementation', 2, 3, 'solidity/contracts/peripherals/interfaces/IAugur.sol'),
	node('statoblast-ierc165', 'IERC165', 'interface', 'statoblast-implementation', 2, 4, 'solidity/contracts/peripherals/interfaces/IERC165.sol'),
	node('statoblast-ierc1155', 'IERC1155', 'interface', 'statoblast-implementation', 2, 5, 'solidity/contracts/peripherals/interfaces/IERC1155.sol'),
	node('statoblast-ierc1155-receiver', 'IERC1155Receiver', 'interface', 'statoblast-implementation', 2, 6, 'solidity/contracts/peripherals/interfaces/IERC1155Receiver.sol'),
	node('statoblast-escalation-events', 'IEscalationGameEvents', 'interface', 'statoblast-implementation', 3, 0, 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol'),
	node('statoblast-security-pool-interface', 'ISecurityPool', 'interface', 'statoblast-implementation', 3, 1, 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol'),
	node('statoblast-security-pool-factory-interface', 'ISecurityPoolFactory', 'interface', 'statoblast-implementation', 3, 2, 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol'),
	node('statoblast-forker-events', 'ISecurityPoolForkerEvents', 'interface', 'statoblast-implementation', 3, 3, 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol'),
	node('statoblast-forker-interface', 'ISecurityPoolForker', 'interface', 'statoblast-implementation', 3, 4, 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol'),
	node('statoblast-child-game-initializer', 'ISecurityPoolForkerChildEscalationGameInitializer', 'interface', 'statoblast-implementation', 3, 5, 'solidity/contracts/peripherals/interfaces/ISecurityPoolForkerChildEscalationGameInitializer.sol'),
	node('statoblast-share-token-interface', 'IShareToken', 'interface', 'statoblast-implementation', 4, 0, 'solidity/contracts/peripherals/interfaces/IShareToken.sol'),
	node('statoblast-auction-events', 'IUniformPriceDualCapBatchAuctionEvents', 'interface', 'statoblast-implementation', 4, 1, 'solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol'),
	node('statoblast-auction-interface', 'IUniformPriceDualCapBatchAuction', 'interface', 'statoblast-implementation', 4, 2, 'solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol'),
	node('statoblast-iweth9', 'IWeth9', 'interface', 'statoblast-implementation', 4, 3, 'solidity/contracts/peripherals/interfaces/IWeth9.sol'),

	// Deployment infrastructure, compatibility contracts, and the imported OpenOracle boundary.
	node('infra-deployment-status-oracle', 'DeploymentStatusOracle', 'contract', 'infrastructure', 0, 0, 'solidity/contracts/DeploymentStatusOracle.sol'),
	node('infra-multicall3', 'Multicall3', 'contract', 'infrastructure', 0, 1, 'solidity/contracts/peripherals/Multicall3.sol'),
	node('infra-weth9', 'WETH9', 'contract', 'infrastructure', 0, 2, 'solidity/contracts/peripherals/WETH9.sol'),
	node('openoracle-core', 'OpenOracle', 'contract', 'infrastructure', 1, 1, 'solidity/contracts/peripherals/openOracle/OpenOracle.sol'),
	node('openoracle-signature-transfer', 'ISignatureTransfer', 'interface', 'infrastructure', 2, 0, 'solidity/contracts/peripherals/openOracle/interfaces/ISignatureTransfer.sol'),
	node('openoracle-errors', 'Errors', 'library', 'infrastructure', 2, 1, 'solidity/contracts/peripherals/openOracle/libraries/Errors.sol'),
	node('openoracle-ierc20', 'OpenZeppelin IERC20', 'interface', 'infrastructure', 2, 2, 'solidity/contracts/peripherals/openOracle/openzeppelin/contracts/token/ERC20/IERC20.sol', 'IERC20'),
	node('openoracle-safe-erc20', 'SafeERC20', 'library', 'infrastructure', 2, 3, 'solidity/contracts/peripherals/openOracle/openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol'),
	node('openoracle-ierc1363', 'IERC1363', 'interface', 'infrastructure', 3, 0, 'solidity/contracts/peripherals/openOracle/openzeppelin/contracts/interfaces/IERC1363.sol'),
	node('openoracle-ierc165', 'OpenZeppelin IERC165', 'interface', 'infrastructure', 3, 1, 'solidity/contracts/peripherals/openOracle/openzeppelin/contracts/utils/introspection/IERC165.sol', 'IERC165'),
	node('openoracle-math', 'Math', 'library', 'infrastructure', 3, 2, 'solidity/contracts/peripherals/openOracle/openzeppelin/contracts/utils/math/Math.sol'),
	node('openoracle-safe-cast', 'SafeCast', 'library', 'infrastructure', 3, 3, 'solidity/contracts/peripherals/openOracle/openzeppelin/contracts/utils/math/SafeCast.sol'),
	node('openoracle-panic', 'Panic', 'library', 'infrastructure', 4, 0, 'solidity/contracts/peripherals/openOracle/openzeppelin/contracts/utils/Panic.sol'),
	node('openoracle-reentrancy-guard', 'ReentrancyGuard', 'abstract', 'infrastructure', 4, 1, 'solidity/contracts/peripherals/openOracle/openzeppelin/contracts/utils/ReentrancyGuard.sol'),
	node('openoracle-storage-slot', 'StorageSlot', 'library', 'infrastructure', 4, 2, 'solidity/contracts/peripherals/openOracle/openzeppelin/contracts/utils/StorageSlot.sol'),

	// Every Solidity declaration under contracts/test is retained in a separate test-only region.
	node('test-complete-set-reentrant-receiver', 'CompleteSetReentrantReceiver', 'contract', 'tests', 0, 0, 'solidity/contracts/test/peripherals/CompleteSetReentrantReceiver.sol'),
	node('test-erc1155-coverage-harness', 'ERC1155CoverageHarness', 'contract', 'tests', 0, 1, 'solidity/contracts/test/peripherals/CoverageHelpersHarness.sol'),
	node('test-coverage-attribution-executed', 'CoverageAttributionExecuted', 'contract', 'tests', 0, 2, 'solidity/contracts/test/peripherals/CoverageHelpersHarness.sol'),
	node('test-coverage-attribution-decoy', 'CoverageAttributionDecoy', 'contract', 'tests', 0, 3, 'solidity/contracts/test/peripherals/CoverageHelpersHarness.sol'),
	node('test-escalation-factory-coverage-pool', 'EscalationGameFactoryCoverageSecurityPool', 'contract', 'tests', 0, 4, 'solidity/contracts/test/peripherals/CoverageHelpersHarness.sol'),
	node('test-coverage-helpers-harness', 'CoverageHelpersHarness', 'contract', 'tests', 0, 5, 'solidity/contracts/test/peripherals/CoverageHelpersHarness.sol'),
	node('test-erc1155-receiver-mock', 'ERC1155ReceiverMock', 'contract', 'tests', 1, 0, 'solidity/contracts/test/peripherals/ERC1155ReceiverMock.sol'),
	node('test-erc1155-non-receiver', 'ERC1155NonReceiver', 'contract', 'tests', 1, 1, 'solidity/contracts/test/peripherals/ERC1155ReceiverMock.sol'),
	node('test-share-token-authorization-pool', 'ShareTokenAuthorizationPoolMock', 'contract', 'tests', 1, 2, 'solidity/contracts/test/peripherals/ERC1155ReceiverMock.sol'),
	node('test-fork-boundary-zoltar', 'EscalationGameForkBoundaryZoltar', 'contract', 'tests', 1, 3, 'solidity/contracts/test/peripherals/EscalationGameForkThresholdHarness.sol'),
	node('test-fork-boundary-pool', 'EscalationGameForkBoundarySecurityPool', 'contract', 'tests', 1, 4, 'solidity/contracts/test/peripherals/EscalationGameForkThresholdHarness.sol'),
	node('test-fork-threshold-harness', 'EscalationGameForkThresholdHarness', 'contract', 'tests', 1, 5, 'solidity/contracts/test/peripherals/EscalationGameForkThresholdHarness.sol'),
	node('test-escalation-forker-harness', 'EscalationGameForkerHarness', 'contract', 'tests', 1, 6, 'solidity/contracts/test/peripherals/EscalationGameForkerHarness.sol'),
	node('test-escalation-proof-pool', 'EscalationGameProofTestSecurityPool', 'contract', 'tests', 2, 0, 'solidity/contracts/test/peripherals/EscalationGameProofTestSecurityPool.sol'),
	node('test-false-returning-erc20', 'FalseReturningERC20', 'contract', 'tests', 2, 1, 'solidity/contracts/test/peripherals/FalseReturningERC20.sol'),
	node('test-incompatible-proof-verifier', 'IncompatibleEscalationGameProofVerifier', 'contract', 'tests', 2, 2, 'solidity/contracts/test/peripherals/IncompatibleEscalationGameProofVerifier.sol'),
	node('test-openoracle-adversarial-target', 'IOpenOracleAdversarialTarget', 'interface', 'tests', 2, 3, 'solidity/contracts/test/peripherals/OpenOracleAdversarialHarnesses.sol'),
	node('test-openoracle-token', 'OpenOracleTestToken', 'contract', 'tests', 2, 4, 'solidity/contracts/test/peripherals/OpenOracleAdversarialHarnesses.sol'),
	node('test-openoracle-no-return-token', 'OpenOracleNoReturnToken', 'contract', 'tests', 2, 5, 'solidity/contracts/test/peripherals/OpenOracleAdversarialHarnesses.sol'),
	node('test-openoracle-rejecting-receiver', 'OpenOracleRejectingETHReceiver', 'contract', 'tests', 2, 6, 'solidity/contracts/test/peripherals/OpenOracleAdversarialHarnesses.sol'),
	node('test-openoracle-reentrant-callback', 'OpenOracleReentrantCallback', 'contract', 'tests', 2, 7, 'solidity/contracts/test/peripherals/OpenOracleAdversarialHarnesses.sol'),
	node('test-own-fork-claim-harness', 'OwnForkEscalationClaimHarness', 'contract', 'tests', 3, 0, 'solidity/contracts/test/peripherals/OwnForkEscalationClaimHarness.sol'),
	node('test-safe-erc20-ops-harness', 'SafeERC20OpsHarness', 'contract', 'tests', 3, 1, 'solidity/contracts/test/peripherals/SafeERC20OpsHarness.sol'),
	node('test-security-pool-ancestor', 'SecurityPoolAncestorTestNode', 'contract', 'tests', 3, 2, 'solidity/contracts/test/peripherals/SecurityPoolAncestorTestNode.sol'),
	node('test-constructor-failure-zoltar', 'SecurityPoolConstructorFailureZoltar', 'contract', 'tests', 3, 3, 'solidity/contracts/test/peripherals/SecurityPoolConstructorFailureZoltar.sol'),
	node('test-forker-child-validation-harness', 'SecurityPoolForkerChildGameValidationHarness', 'contract', 'tests', 3, 4, 'solidity/contracts/test/peripherals/SecurityPoolForkerAttackMocks.sol'),
	node('test-forker-malicious-emitter', 'SecurityPoolForkerMaliciousEventEmitter', 'contract', 'tests', 3, 5, 'solidity/contracts/test/peripherals/SecurityPoolForkerAttackMocks.sol'),
	node('test-forker-fake-pool', 'SecurityPoolForkerFakePoolMock', 'contract', 'tests', 3, 6, 'solidity/contracts/test/peripherals/SecurityPoolForkerAttackMocks.sol'),
	node('test-forker-attack-factory', 'SecurityPoolForkerAttackFactoryMock', 'contract', 'tests', 3, 7, 'solidity/contracts/test/peripherals/SecurityPoolForkerAttackMocks.sol'),
	node('test-forker-attack-parent', 'SecurityPoolForkerAttackParentMock', 'contract', 'tests', 4, 0, 'solidity/contracts/test/peripherals/SecurityPoolForkerAttackMocks.sol'),
	node('test-forker-escrow-factory', 'SecurityPoolForkerEscrowAttackFactoryMock', 'contract', 'tests', 4, 1, 'solidity/contracts/test/peripherals/SecurityPoolForkerAttackMocks.sol'),
	node('test-forker-escrow-game', 'SecurityPoolForkerEscrowAttackGameMock', 'contract', 'tests', 4, 2, 'solidity/contracts/test/peripherals/SecurityPoolForkerAttackMocks.sol'),
	node('test-forker-escrow-parent', 'SecurityPoolForkerEscrowAttackParentMock', 'contract', 'tests', 4, 3, 'solidity/contracts/test/peripherals/SecurityPoolForkerAttackMocks.sol'),
	node('test-forker-alternating-game', 'SecurityPoolForkerAlternatingChildGameMock', 'contract', 'tests', 4, 4, 'solidity/contracts/test/peripherals/SecurityPoolForkerAttackMocks.sol'),
	node('test-forker-escrow-child', 'SecurityPoolForkerEscrowAttackChildMock', 'contract', 'tests', 4, 5, 'solidity/contracts/test/peripherals/SecurityPoolForkerAttackMocks.sol'),
	node('test-auction-settlement-pool', 'AuctionSettlementPoolHarness', 'contract', 'tests', 4, 6, 'solidity/contracts/test/peripherals/SecurityPoolForkerAuctionSettlementHarness.sol'),
	node('test-forker-auction-settlement', 'SecurityPoolForkerAuctionSettlementHarness', 'contract', 'tests', 4, 7, 'solidity/contracts/test/peripherals/SecurityPoolForkerAuctionSettlementHarness.sol'),
]

const contractAtlasSemanticEdges: ContractAtlasEdge[] = [
	// Zoltar implementation and runtime.
	edge('zoltar-question-scalar', 'zoltar-question-data', 'zoltar-scalar-outcomes', 'uses', 'Decodes and names scalar outcomes with the shared scalar library.'),
	edge('zoltar-core-constants', 'zoltar-core', 'zoltar-constants', 'uses', 'Reads protocol addresses and fork limits.'),
	edge('zoltar-core-safe-erc20', 'zoltar-core', 'zoltar-safe-erc20-ops', 'uses', 'Moves genesis REP through checked ERC-20 calls.'),
	edge('zoltar-core-ierc20', 'zoltar-core', 'zoltar-ierc20', 'uses', 'Treats genesis REP as the repository ERC-20 interface.'),
	edge('zoltar-core-question-data', 'zoltar-core', 'zoltar-question-data', 'calls', 'Validates fork questions, end times, and child outcomes.'),
	edge('zoltar-core-reputation-token', 'zoltar-core', 'zoltar-reputation-token', 'deploys', 'Deploys child REP and exclusively sets supply, mints, and burns it.'),
	edge('zoltar-reputation-erc20', 'zoltar-reputation-token', 'zoltar-erc20', 'inherits', 'Uses the repository ERC-20 balance and allowance implementation.'),
	edge('zoltar-erc20-context', 'zoltar-erc20', 'zoltar-context', 'inherits', 'Uses the shared message-sender context base.'),
	edge('zoltar-erc20-interface', 'zoltar-erc20', 'zoltar-ierc20', 'implements', 'Implements the repository ERC-20 surface.'),
	edge('zoltar-erc20-metadata', 'zoltar-erc20', 'zoltar-ierc20-metadata', 'implements', 'Implements ERC-20 name, symbol, and decimals metadata.'),
	edge('zoltar-metadata-erc20', 'zoltar-ierc20-metadata', 'zoltar-ierc20', 'inherits', 'Extends the base ERC-20 interface.'),
	edge('zoltar-safe-ops-interface', 'zoltar-safe-erc20-ops', 'zoltar-ierc20', 'uses', 'Wraps repository ERC-20 calls with return-data checks.'),

	// Statoblast construction.
	edge('factory-interface', 'statoblast-security-pool-factory', 'statoblast-security-pool-factory-interface', 'implements', 'Implements origin and canonical child-pool deployment.'),
	edge('factory-question-data', 'statoblast-security-pool-factory', 'zoltar-question-data', 'calls', 'Validates that origin markets use an existing Yes/No question.'),
	edge('factory-zoltar', 'statoblast-security-pool-factory', 'zoltar-core', 'calls', 'Reads universe, REP, fork, and non-decision-threshold state.'),
	edge('factory-share-factory', 'statoblast-security-pool-factory', 'statoblast-share-token-factory', 'calls', 'Requests the origin lineage share token.'),
	edge('factory-share-token', 'statoblast-security-pool-factory', 'statoblast-share-token', 'calls', 'Authorizes the newly deployed origin pool on its lineage share token.'),
	edge('share-factory-share', 'statoblast-share-token-factory', 'statoblast-share-token', 'deploys', 'Deploys a CREATE2 share token bound to Zoltar and the pool factory.'),
	edge('share-factory-zoltar', 'statoblast-share-token-factory', 'zoltar-core', 'uses', 'Wires the shared Zoltar registry into every deployed share token.'),
	edge('factory-price-factory', 'statoblast-security-pool-factory', 'statoblast-price-coordinator-factory', 'calls', 'Requests one REP/WETH price coordinator per pool.'),
	edge('price-factory-coordinator', 'statoblast-price-coordinator-factory', 'statoblast-price-coordinator', 'deploys', 'Deploys and configures the pool price coordinator.'),
	edge('price-factory-weth', 'statoblast-price-coordinator-factory', 'statoblast-iweth9', 'uses', 'Wires its immutable WETH contract into each coordinator.'),
	edge('factory-price-coordinator', 'statoblast-security-pool-factory', 'statoblast-price-coordinator', 'calls', 'Permanently binds the newly deployed coordinator to its canonical pool.'),
	edge('factory-auction-factory', 'statoblast-security-pool-factory', 'statoblast-auction-factory', 'calls', 'Requests a truth auction for each child pool.'),
	edge('auction-factory-auction', 'statoblast-auction-factory', 'statoblast-truth-auction', 'deploys', 'Deploys a CREATE2 auction owned by the shared forker.'),
	edge('factory-pool-deployer', 'statoblast-security-pool-factory', 'statoblast-security-pool-deployer', 'deploys', 'Deploys its private pool init-code coordinator.'),
	edge('factory-pool-deployer-call', 'statoblast-security-pool-factory', 'statoblast-security-pool-deployer', 'calls', 'Calls the private deployer for every origin or child pool after assembling its dependencies.'),
	edge('pool-deployer-emitter', 'statoblast-security-pool-deployer', 'statoblast-event-emitter', 'deploys', 'Deploys the event implementation shared by pools from this factory.'),
	edge('pool-deployer-worker', 'statoblast-security-pool-deployer', 'statoblast-security-pool-worker', 'deploys', 'Deploys the worker that stores large pool creation code.'),
	edge('worker-config-interface', 'statoblast-security-pool-worker', 'statoblast-deployment-worker-config', 'compatible', 'Structurally provides the factory and event-emitter getters read through the pool constructor interface.'),
	edge('worker-security-pool', 'statoblast-security-pool-worker', 'statoblast-security-pool', 'deploys', 'CREATE2-deploys each SecurityPool from stored creation code.'),
	edge('escalation-factory-verifier', 'statoblast-escalation-game-factory', 'statoblast-escalation-proof-verifier', 'deploys', 'Deploys and pins the code-hash-checked proof verifier.'),
	edge('escalation-factory-game', 'statoblast-escalation-game-factory', 'statoblast-escalation-game', 'deploys', 'Deploys fresh and fork-continuation escalation games for pools.'),
	edge('escalation-factory-pool', 'statoblast-escalation-game-factory', 'statoblast-security-pool-interface', 'calls', 'Reads the calling pool, parent, REP token, and shared forker configuration.'),
	edge('escalation-factory-forker', 'statoblast-escalation-game-factory', 'statoblast-forker-interface', 'calls', 'Reads own-fork haircut and REP-bucket state for child continuations.'),

	// Statoblast market and oracle runtime.
	edge('pool-interface', 'statoblast-security-pool', 'statoblast-security-pool-interface', 'implements', 'Implements the market, vault, escalation, and migration surface.'),
	edge('pool-worker-config', 'statoblast-security-pool', 'statoblast-deployment-worker-config', 'calls', 'Reads its factory and event-emitter wiring from the deployment worker.'),
	edge('pool-reputation-token', 'statoblast-security-pool', 'zoltar-reputation-token', 'assets', 'Uses REP token calls to move REP vault or reporter → pool, pool → escalation game or forker, and pool → redemption recipient.'),
	edge('pool-share-token', 'statoblast-security-pool', 'statoblast-share-token', 'calls', 'Mints and burns complete sets, redeems winning shares, and authorizes child pools.'),
	edge('pool-escalation-factory', 'statoblast-security-pool', 'statoblast-escalation-game-factory', 'calls', 'Lazily deploys a local game on the first deposit, or deploys a fork-continuation game when the forker initializes inherited state.'),
	edge('pool-escalation-game', 'statoblast-security-pool', 'statoblast-escalation-game', 'assets', 'Reads resolution state while reporting REP moves pool → game escrow and settled REP moves game → pool or claimant.'),
	edge('pool-price-coordinator', 'statoblast-security-pool', 'statoblast-price-coordinator', 'calls', 'Reads cached REP/ETH prices and exposes coordinator-only risk execution.'),
	edge('price-coordinator-pool', 'statoblast-price-coordinator', 'statoblast-security-pool', 'calls', 'Executes staged liquidation, withdrawal, and allowance operations after validation.'),
	edge('price-coordinator-openoracle', 'statoblast-price-coordinator', 'openoracle-core', 'assets', 'Funds reports with WETH and REP coordinator → OpenOracle, then requests settled balances OpenOracle → sponsor.'),
	edge('openoracle-price-callback', 'openoracle-core', 'statoblast-price-coordinator', 'calls', 'Calls openOracleCallback after report settlement.'),
	edge('price-coordinator-weth', 'statoblast-price-coordinator', 'statoblast-iweth9', 'assets', 'Calls WETH to move sponsor → coordinator, grants coordinator → OpenOracle allowance, and requests settled WETH OpenOracle → sponsor.'),
	edge('price-coordinator-rep', 'statoblast-price-coordinator', 'zoltar-reputation-token', 'assets', 'Calls REP to move sponsor → coordinator, grants coordinator → OpenOracle allowance, and requests settled REP OpenOracle → sponsor.'),
	edge('price-coordinator-pool-utils', 'statoblast-price-coordinator', 'statoblast-security-pool-utils', 'uses', 'Uses shared BPS and minimum-REP constants.'),
	edge('price-coordinator-math', 'statoblast-price-coordinator', 'openoracle-math', 'uses', 'Uses checked rounding for report funding and risk thresholds.'),
	edge('price-coordinator-stored-game', 'statoblast-price-coordinator', 'statoblast-stored-open-oracle-game', 'uses', 'Uses a narrow compatibility view of OpenOracle stored-game data.'),
	edge('share-token-erc1155', 'statoblast-share-token', 'statoblast-erc1155', 'inherits', 'Extends the repository ERC-1155 implementation with universe-aware claims.'),
	edge('share-token-interface', 'statoblast-share-token', 'statoblast-share-token-interface', 'implements', 'Implements the pool and migration-facing share-token API.'),
	edge('share-token-token-id', 'statoblast-share-token', 'statoblast-token-id', 'uses', 'Packs and unpacks universe and outcome identifiers.'),
	edge('share-token-binary-outcomes', 'statoblast-share-token', 'statoblast-binary-outcomes', 'uses', 'Maps each universe to Invalid, Yes, and No token IDs.'),
	edge('share-token-zoltar', 'statoblast-share-token', 'zoltar-core', 'calls', 'Derives child universes and inspects fork state.'),
	edge('share-token-pool', 'statoblast-share-token', 'statoblast-security-pool-interface', 'calls', 'Validates source and candidate canonical pools during migration and authorization.'),
	edge('share-token-forker', 'statoblast-share-token', 'statoblast-pool-forker', 'calls', 'Activates the source fork and lazily creates child pools during share migration.'),
	edge('erc1155-interface', 'statoblast-erc1155', 'statoblast-ierc1155', 'implements', 'Implements ERC-1155 balances, transfers, approvals, minting, and burning.'),
	edge('erc1155-receiver', 'statoblast-erc1155', 'statoblast-ierc1155-receiver', 'calls', 'Performs safe single and batch receiver callbacks.'),
	edge('ierc1155-erc165', 'statoblast-ierc1155', 'statoblast-ierc165', 'inherits', 'Extends ERC-165 interface discovery.'),
	edge('receiver-erc165', 'statoblast-ierc1155-receiver', 'statoblast-ierc165', 'inherits', 'Extends ERC-165 interface discovery.'),
	edge('pool-event-emitter', 'statoblast-security-pool', 'statoblast-event-emitter', 'delegatecall', 'Emits accounting checkpoints in the pool address and storage context.'),
	edge('pool-forker-runtime', 'statoblast-security-pool', 'statoblast-pool-forker', 'calls', 'Reads outcomes and grants the shared forker privileged migration entrypoints.'),
	edge('pool-zoltar-runtime', 'statoblast-security-pool', 'zoltar-core', 'calls', 'Reads universe fork timing and burns resolution haircuts through Zoltar.'),
	edge('pool-question-runtime', 'statoblast-security-pool', 'zoltar-question-data', 'calls', 'Reads the market question end date.'),
	edge('pool-utils-runtime', 'statoblast-security-pool', 'statoblast-security-pool-utils', 'uses', 'Uses shared fee, auction, and minimum-REP constants.'),
	edge('pool-binary-outcomes', 'statoblast-security-pool', 'statoblast-binary-outcomes', 'uses', 'Uses the canonical Invalid/Yes/No outcome enum.'),

	// Escalation inheritance, delegate, proof, and settlement relationships.
	edge('game-settlement-base', 'statoblast-escalation-game', 'statoblast-escalation-settlement', 'inherits', 'Exposes the top of the shared escalation inheritance stack.'),
	edge('settlement-escrow-base', 'statoblast-escalation-settlement', 'statoblast-escalation-escrow', 'inherits', 'Adds claim, withdrawal, and residual settlement over escrow state.'),
	edge('escrow-carry-base', 'statoblast-escalation-escrow', 'statoblast-escalation-carry', 'inherits', 'Adds vault and fork escrow accounting over carry state.'),
	edge('carry-calculation-base', 'statoblast-escalation-carry', 'statoblast-escalation-calculations', 'inherits', 'Adds carry trees and proof consumption over dispute calculations.'),
	edge('calculation-state-base', 'statoblast-escalation-calculations', 'statoblast-escalation-state', 'inherits', 'Adds pure and view dispute calculations over shared state.'),
	edge('state-storage-base', 'statoblast-escalation-state', 'statoblast-escalation-storage', 'inherits', 'Owns the concrete game state layout.'),
	edge('state-events-interface', 'statoblast-escalation-state', 'statoblast-escalation-events', 'implements', 'Implements the shared escalation event surface.'),
	edge('game-deposit-delegate-deploy', 'statoblast-escalation-game', 'statoblast-escalation-deposit-delegate', 'deploys', 'Deploys one immutable deposit implementation per game.'),
	edge('game-deposit-delegate-call', 'statoblast-escalation-game', 'statoblast-escalation-deposit-delegate', 'delegatecall', 'Runs deposit mutation against EscalationGame storage.'),
	edge('deposit-delegate-storage', 'statoblast-escalation-deposit-delegate', 'statoblast-escalation-storage', 'inherits', 'Shares the exact game storage layout required for delegatecall.'),
	edge('deposit-delegate-events', 'statoblast-escalation-deposit-delegate', 'statoblast-escalation-events', 'implements', 'Emits game events from the delegated storage context.'),
	edge('deposit-delegate-context', 'statoblast-escalation-deposit-delegate', 'statoblast-escalation-deposit-context', 'calls', 'Calls back into the active game context for view calculations.'),
	edge('deposit-delegate-mmr', 'statoblast-escalation-deposit-delegate', 'statoblast-merkle-mountain-range', 'uses', 'Appends canonical carry leaves.'),
	edge('state-proof-verifier', 'statoblast-escalation-state', 'statoblast-escalation-proof-verifier', 'calls', 'Pins and reads the storage-free proof verifier.'),
	edge('state-reputation-token', 'statoblast-escalation-state', 'zoltar-reputation-token', 'assets', 'Uses REP token calls to move game escrow → claimant, pool, or fork export recipient.'),
	edge('carry-proof-verifier', 'statoblast-escalation-carry', 'statoblast-escalation-proof-verifier', 'calls', 'Verifies Merkle Mountain Range and nullifier proofs.'),
	edge('proof-verifier-mmr', 'statoblast-escalation-proof-verifier', 'statoblast-merkle-mountain-range', 'uses', 'Computes carry roots and proof paths.'),
	edge('escalation-types-storage', 'statoblast-escalation-storage', 'statoblast-escalation-types', 'uses', 'Stores the shared outcome, deposit, node, and fork-escrow structures.'),
	edge('escalation-types-carry', 'statoblast-escalation-carry', 'statoblast-escalation-types', 'uses', 'Consumes the shared carry and proof structures.'),
	edge('escalation-binary-calculations', 'statoblast-escalation-calculations', 'statoblast-binary-outcomes', 'uses', 'Calculates Invalid/Yes/No resolution and attrition state.'),
	edge('escalation-settlement-pool', 'statoblast-escalation-settlement', 'statoblast-security-pool', 'calls', 'Returns residual REP and asks the pool to burn winner haircuts.'),
	edge('escalation-settlement-forker', 'statoblast-escalation-settlement', 'statoblast-forker-interface', 'calls', 'Checks direct own-fork claim lineage and question outcomes.'),

	// Fork, migration, and truth-auction implementation.
	edge('forker-base-inheritance', 'statoblast-pool-forker', 'statoblast-forker-base', 'inherits', 'Uses shared fork storage, validation, and events.'),
	edge('forker-base-storage', 'statoblast-forker-base', 'statoblast-forker-storage', 'inherits', 'Shares the canonical delegate-compatible forker layout.'),
	edge('forker-base-events', 'statoblast-forker-base', 'statoblast-forker-events', 'implements', 'Implements the shared fork-event surface.'),
	edge('vault-base-forker-base', 'statoblast-vault-migration-base', 'statoblast-forker-base', 'inherits', 'Adds child deployment, REP splitting, and vault migration helpers.'),
	edge('vault-delegate-base', 'statoblast-vault-migration-delegate', 'statoblast-vault-migration-base', 'inherits', 'Runs vault and child migration against the forker layout.'),
	edge('escalation-forker-base', 'statoblast-escalation-game-forker', 'statoblast-vault-migration-base', 'inherits', 'Runs escalation continuation against the forker layout.'),
	edge('event-emitter-storage', 'statoblast-event-emitter', 'statoblast-forker-storage', 'inherits', 'Shares the forker layout so delegate-emitted events carry authoritative values.'),
	edge('event-emitter-events', 'statoblast-event-emitter', 'statoblast-forker-events', 'implements', 'Emits the shared fork-event surface.'),
	edge('forker-interface-events', 'statoblast-forker-interface', 'statoblast-forker-events', 'inherits', 'Extends the event interface with callable fork operations.'),
	edge('auction-interface-events', 'statoblast-auction-interface', 'statoblast-auction-events', 'inherits', 'Extends auction events with callable settlement operations.'),
	edge('auction-events-implementation', 'statoblast-truth-auction', 'statoblast-auction-events', 'implements', 'Emits the canonical auction event surface.'),
	edge('auction-math', 'statoblast-truth-auction', 'openoracle-math', 'uses', 'Uses full-precision arithmetic for clearing and pro-rata settlement.'),
	edge('forker-deploy-vault-delegate', 'statoblast-pool-forker', 'statoblast-vault-migration-delegate', 'deploys', 'Deploys the immutable vault-migration delegate.'),
	edge('forker-deploy-escalation-delegate', 'statoblast-pool-forker', 'statoblast-escalation-game-forker', 'deploys', 'Deploys the immutable escalation-migration delegate.'),
	edge('forker-deploy-event-emitter', 'statoblast-pool-forker', 'statoblast-event-emitter', 'deploys', 'Deploys the immutable fork event implementation.'),
	edge('forker-delegate-vault', 'statoblast-pool-forker', 'statoblast-vault-migration-delegate', 'delegatecall', 'Runs child creation and vault migration in shared forker storage.'),
	edge('forker-delegate-escalation', 'statoblast-pool-forker', 'statoblast-escalation-game-forker', 'delegatecall', 'Runs escalation continuation and claim migration in shared forker storage.'),
	edge('forker-delegate-events', 'statoblast-pool-forker', 'statoblast-event-emitter', 'delegatecall', 'Emits fork snapshots from the forker address.'),
	edge('forker-deploy-proxy', 'statoblast-pool-forker', 'statoblast-migration-proxy', 'deploys', 'CREATE2-deploys one stable REP migration adapter per parent pool.'),
	edge('forker-proxy-assets', 'statoblast-pool-forker', 'statoblast-migration-proxy', 'assets', 'Transfers parent REP forker → migration proxy, then instructs the proxy to lock, fork, split, and sweep child REP.'),
	edge('forker-reputation-token', 'statoblast-pool-forker', 'zoltar-reputation-token', 'assets', 'Calls the parent REP token to transfer REP forker → stable migration proxy.'),
	edge('proxy-zoltar', 'statoblast-migration-proxy', 'zoltar-core', 'calls', 'Owns the literal Zoltar migration ledger balance for one parent pool.'),
	edge('proxy-reputation-token', 'statoblast-migration-proxy', 'zoltar-reputation-token', 'assets', 'Calls REP to grant proxy → Zoltar allowance and transfer minted child REP proxy → configured receiver.'),
	edge('forker-zoltar', 'statoblast-pool-forker', 'zoltar-core', 'calls', 'Reads fork thresholds and migration balances around proxy operations.'),
	edge('forker-pool', 'statoblast-pool-forker', 'statoblast-security-pool', 'calls', 'Freezes parents, migrates children, and updates collateral and ownership accounting.'),
	edge('forker-game', 'statoblast-pool-forker', 'statoblast-escalation-game', 'calls', 'Snapshots escalation state and resolves inherited question outcomes.'),
	edge('forker-auction', 'statoblast-pool-forker', 'statoblast-truth-auction', 'assets', 'Coordinates ETH bidder → auction → forker → child pool or, for refunds, auction → bidder; purchased REP is credited as pool ownership rather than transferred.'),
	edge('vault-base-zoltar', 'statoblast-vault-migration-base', 'zoltar-core', 'calls', 'Deploys missing child universes and reads child REP.'),
	edge('vault-base-factory', 'statoblast-vault-migration-base', 'statoblast-security-pool-factory', 'calls', 'Requests canonical child-pool deployment.'),
	edge('vault-base-pool', 'statoblast-vault-migration-base', 'statoblast-security-pool', 'calls', 'Copies vault, collateral, and ownership state into child pools.'),
	edge('vault-base-proxy', 'statoblast-vault-migration-base', 'statoblast-migration-proxy', 'assets', 'Calls the proxy so split child REP moves migration proxy → child pools and escalation games.'),
	edge('vault-base-types', 'statoblast-vault-migration-base', 'statoblast-forker-types', 'uses', 'Stores and mutates typed fork, auction, and migration records.'),
	edge('forker-storage-types', 'statoblast-forker-storage', 'statoblast-forker-types', 'uses', 'Owns the typed per-pool fork and migration mappings.'),
	edge('escalation-forker-child-interface', 'statoblast-escalation-game-forker', 'statoblast-child-game-initializer', 'calls', 'Initializes child escalation carry snapshots through the narrow child API.'),
	edge('escalation-forker-game', 'statoblast-escalation-game-forker', 'statoblast-escalation-game', 'calls', 'Exports, materializes, resumes, and settles forked escalation state.'),
	edge('escalation-forker-pool', 'statoblast-escalation-game-forker', 'statoblast-security-pool', 'calls', 'Updates child pool escalation accounting.'),
	edge('escalation-forker-zoltar', 'statoblast-escalation-game-forker', 'zoltar-core', 'calls', 'Reads universe and REP relationships during escalation migration.'),
	edge('forker-utils', 'statoblast-pool-forker', 'statoblast-security-pool-utils', 'uses', 'Uses shared auction timing and BPS constants.'),
	edge('forker-binary', 'statoblast-pool-forker', 'statoblast-binary-outcomes', 'uses', 'Tracks fixed and unresolved binary outcomes.'),

	// Compatibility and imported OpenOracle internals.
	edge('weth-interface', 'infra-weth9', 'statoblast-iweth9', 'compatible', 'Structurally provides the WETH surface consumed through the coordinator interface.'),
	edge('openoracle-errors-edge', 'openoracle-core', 'openoracle-errors', 'uses', 'Uses the imported custom-error catalog.'),
	edge('openoracle-permit2', 'openoracle-core', 'openoracle-signature-transfer', 'calls', 'Pulls permit-authorized tokens through the canonical Permit2 singleton.'),
	edge('openoracle-erc20-edge', 'openoracle-core', 'openoracle-ierc20', 'uses', 'Models report tokens through the imported ERC-20 interface.'),
	edge('openoracle-safe-erc20-edge', 'openoracle-core', 'openoracle-safe-erc20', 'uses', 'Moves report tokens through OpenZeppelin safe wrappers.'),
	edge('safe-erc20-interface', 'openoracle-safe-erc20', 'openoracle-ierc20', 'uses', 'Wraps imported ERC-20 transfers and approvals.'),
	edge('safe-erc20-1363', 'openoracle-safe-erc20', 'openoracle-ierc1363', 'uses', 'Supports relaxed ERC-1363 transfer-and-call helpers.'),
	edge('ierc1363-erc20', 'openoracle-ierc1363', 'openoracle-ierc20', 'inherits', 'Extends the imported ERC-20 surface.'),
	edge('ierc1363-erc165', 'openoracle-ierc1363', 'openoracle-ierc165', 'inherits', 'Extends ERC-165 interface discovery.'),
	edge('math-panic', 'openoracle-math', 'openoracle-panic', 'uses', 'Reports arithmetic division and overflow panics.'),
	edge('math-safe-cast', 'openoracle-math', 'openoracle-safe-cast', 'uses', 'Converts comparison results for branchless arithmetic.'),

	// Test-only declarations and the production boundary each one exercises.
	edge('test-complete-set-reentrancy', 'test-complete-set-reentrant-receiver', 'statoblast-security-pool', 'tests', 'Exercises complete-set receiver reentrancy.'),
	edge('test-complete-set-receiver-interface', 'test-complete-set-reentrant-receiver', 'statoblast-ierc1155-receiver', 'implements', 'Implements safe ERC-1155 callbacks while reentering complete-set flows.'),
	edge('test-erc1155-coverage', 'test-erc1155-coverage-harness', 'statoblast-erc1155', 'inherits', 'Exposes protected ERC-1155 helpers for coverage.'),
	edge('test-coverage-deployment-status-oracle', 'test-coverage-helpers-harness', 'infra-deployment-status-oracle', 'deploys', 'Deploys DeploymentStatusOracle with caller-supplied deployment addresses for coverage tests.'),
	edge('test-escalation-factory-pool', 'test-escalation-factory-coverage-pool', 'statoblast-escalation-game-factory', 'tests', 'Acts as a minimal pool caller for factory coverage.'),
	edge('test-coverage-helpers', 'test-coverage-helpers-harness', 'statoblast-escalation-proof-verifier', 'deploys', 'Deploys an immutable proof verifier in the harness constructor and exposes its helpers for coverage.'),
	edge('test-receiver-mock', 'test-erc1155-receiver-mock', 'statoblast-ierc1155-receiver', 'implements', 'Models accepting, rejecting, reverting, and panicking receivers.'),
	edge('test-non-receiver', 'test-erc1155-non-receiver', 'statoblast-erc1155', 'tests', 'Exercises transfers to a contract without receiver support.'),
	edge('test-share-authorization', 'test-share-token-authorization-pool', 'statoblast-share-token', 'calls', 'Models an authorized pool adding a canonical child.'),
	edge('test-threshold-zoltar', 'test-fork-boundary-zoltar', 'zoltar-core', 'tests', 'Supplies controlled fork thresholds for boundary tests.'),
	edge('test-threshold-pool', 'test-fork-boundary-pool', 'statoblast-escalation-game', 'tests', 'Supplies controlled pool state for threshold tests.'),
	edge('test-threshold-harness-edge', 'test-fork-threshold-harness', 'statoblast-escalation-calculations', 'inherits', 'Exposes escalation fork-threshold calculations.'),
	edge('test-escalation-forker-edge', 'test-escalation-forker-harness', 'statoblast-escalation-game-forker', 'tests', 'Relays escalation-forker calls for authorization tests.'),
	edge('test-proof-pool-edge', 'test-escalation-proof-pool', 'statoblast-escalation-proof-verifier', 'tests', 'Provides pool-shaped proof and carry test state.'),
	edge('test-false-erc20-edge', 'test-false-returning-erc20', 'zoltar-ierc20', 'implements', 'Returns false from transfers to exercise checked ERC-20 failures.'),
	edge('test-incompatible-verifier-edge', 'test-incompatible-proof-verifier', 'statoblast-escalation-game-factory', 'tests', 'Exercises verifier code-hash compatibility rejection.'),
	edge('test-openoracle-target-edge', 'test-openoracle-adversarial-target', 'openoracle-core', 'tests', 'Narrows the protocol-fee withdrawal attack surface.'),
	edge('test-openoracle-token-edge', 'test-openoracle-token', 'zoltar-ierc20', 'implements', 'Provides configurable ERC-20 transfer failures to OpenOracle tests.'),
	edge('test-openoracle-no-return-edge', 'test-openoracle-no-return-token', 'openoracle-core', 'tests', 'Models legacy ERC-20 calls with no return value.'),
	edge('test-openoracle-receiver-edge', 'test-openoracle-rejecting-receiver', 'openoracle-core', 'tests', 'Exercises rejected, gas-consuming, and reentrant ETH delivery.'),
	edge('test-openoracle-receiver-interface', 'test-openoracle-rejecting-receiver', 'statoblast-ierc1155-receiver', 'implements', 'Implements ERC-1155 callbacks so the same adversarial receiver can hold shares.'),
	edge('test-openoracle-callback-edge', 'test-openoracle-reentrant-callback', 'openoracle-core', 'tests', 'Exercises settlement callback reentrancy.'),
	edge('test-own-fork-claim-edge', 'test-own-fork-claim-harness', 'statoblast-escalation-game-forker', 'tests', 'Relays direct own-fork escalation claims.'),
	edge('test-safe-ops-edge', 'test-safe-erc20-ops-harness', 'zoltar-safe-erc20-ops', 'tests', 'Exposes checked transfer and transferFrom wrappers.'),
	edge('test-ancestor-edge', 'test-security-pool-ancestor', 'statoblast-security-pool', 'tests', 'Builds controlled pool ancestry graphs.'),
	edge('test-constructor-zoltar-edge', 'test-constructor-failure-zoltar', 'statoblast-security-pool', 'tests', 'Returns malformed Zoltar constructor dependencies.'),
	edge('test-child-validation-edge', 'test-forker-child-validation-harness', 'statoblast-forker-base', 'inherits', 'Exposes child validation from the shared forker base.'),
	edge('test-malicious-emitter-edge', 'test-forker-malicious-emitter', 'statoblast-event-emitter', 'tests', 'Models a layout-incompatible or reverting event delegate.'),
	edge('test-fake-pool-edge', 'test-forker-fake-pool', 'statoblast-security-pool-interface', 'tests', 'Models forged child pool configuration.'),
	edge('test-attack-factory-edge', 'test-forker-attack-factory', 'statoblast-security-pool-factory-interface', 'tests', 'Returns malicious child deployments.'),
	edge('test-attack-parent-edge', 'test-forker-attack-parent', 'statoblast-pool-forker', 'tests', 'Models a parent pool that redirects child deployment.'),
	edge('test-escrow-factory-edge', 'test-forker-escrow-factory', 'statoblast-security-pool-factory-interface', 'tests', 'Builds escrow-accounting attack children.'),
	edge('test-escrow-game-edge', 'test-forker-escrow-game', 'statoblast-escalation-game', 'tests', 'Models inconsistent escalation escrow state.'),
	edge('test-escrow-parent-edge', 'test-forker-escrow-parent', 'statoblast-pool-forker', 'tests', 'Models malicious parent escalation migration state.'),
	edge('test-alternating-game-edge', 'test-forker-alternating-game', 'statoblast-escalation-game', 'tests', 'Alternates child game answers across validation reads.'),
	edge('test-escrow-child-edge', 'test-forker-escrow-child', 'statoblast-security-pool', 'tests', 'Models a malicious child pool during escrow migration.'),
	edge('test-auction-pool-edge', 'test-auction-settlement-pool', 'statoblast-security-pool', 'tests', 'Provides controlled auction settlement accounting.'),
	edge('test-auction-forker-edge', 'test-forker-auction-settlement', 'statoblast-pool-forker', 'inherits', 'Exposes auction settlement helpers from the production forker.'),
]

const contractAtlasNodeById = new Map(contractAtlasNodes.map(atlasNode => [atlasNode.id, atlasNode]))
const semanticPairIds = new Set(contractAtlasSemanticEdges.map(atlasEdge => `${atlasEdge.source}->${atlasEdge.target}`))
const contractAtlasSourceReferenceEdges = contractAtlasSourceReferences.flatMap(reference => {
	if (semanticPairIds.has(`${reference.source}->${reference.target}`)) return []
	const targetNode = contractAtlasNodeById.get(reference.target)
	if (targetNode === undefined) throw new Error(`Contract atlas source reference targets missing node ${reference.target}`)
	return [edge(`source-reference-${reference.source}--${reference.target}`, reference.source, reference.target, 'references', `Directly references ${reference.symbols.join(', ')} from the ${targetNode.label} source unit.`)]
})

export const contractAtlasEdges: ContractAtlasEdge[] = [...contractAtlasSemanticEdges, ...contractAtlasSourceReferenceEdges]

const contractAtlasPlotRouteByPair = new Map<string, ContractAtlasPlotRoute>()
for (const atlasEdge of contractAtlasEdges) {
	const pair = `${atlasEdge.source}->${atlasEdge.target}`
	const route = contractAtlasPlotRouteByPair.get(pair)
	if (route === undefined) {
		contractAtlasPlotRouteByPair.set(pair, {
			edges: [atlasEdge],
			id: `plot-route-${atlasEdge.source}--${atlasEdge.target}`,
			source: atlasEdge.source,
			target: atlasEdge.target,
		})
	} else {
		route.edges.push(atlasEdge)
	}
}

export const contractAtlasPlotRoutes = [...contractAtlasPlotRouteByPair.values()]

export function contractAtlasPlotRouteMeaning(route: ContractAtlasPlotRoute): string {
	return route.edges.map(atlasEdge => `${contractAtlasRelationLabels[atlasEdge.relation]}: ${atlasEdge.description}`).join('\n')
}

export const contractAtlasRelationshipRows = contractAtlasEdges.map(atlasEdge => {
	const source = contractAtlasNodeById.get(atlasEdge.source)
	const target = contractAtlasNodeById.get(atlasEdge.target)
	if (source === undefined || target === undefined) {
		throw new Error(`Contract atlas relationship ${atlasEdge.id} has a missing source or target`)
	}
	return { edge: atlasEdge, source, target }
})
