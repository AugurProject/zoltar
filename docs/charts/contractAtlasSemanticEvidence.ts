import type { ContractAtlasRelation } from './contractAtlas'

type ContractAtlasCheckedRelation = Extract<ContractAtlasRelation, 'assets' | 'calls' | 'compatible' | 'tests' | 'uses'>

type ContractAtlasEvidenceLocation = {
	nodeId: string
	selectors: string[]
}

export type ContractAtlasSemanticClaimEvidence = {
	callSide?: 'inherited-source' | 'receiver'
	locations: ContractAtlasEvidenceLocation[]
	phrase: string
}

type ContractAtlasAssetFlowEvidence = {
	locations: ContractAtlasEvidenceLocation[]
	recipient: string
	sender: string
}

export type ContractAtlasCompatibilityEvidence = {
	members: {
		name: string
		sourceSelector: string
		targetSelector: string
	}[]
	source: string
	target: string
}

export type ContractAtlasTestExecutionEvidence = {
	file: string
	scope?: {
		selectors: string[]
		testName: string
	}
	sourceSelectors: string[]
	target: string
	targetLocations: ContractAtlasEvidenceLocation[]
	targetSelectors: string[]
}

export type ContractAtlasSemanticEvidence = {
	assetFlows?: ContractAtlasAssetFlowEvidence[]
	edgeId: string
	locations: ContractAtlasEvidenceLocation[]
	relation: ContractAtlasCheckedRelation
	source: string
	target: string
}

function location(nodeId: string, ...selectors: string[]): ContractAtlasEvidenceLocation {
	return { nodeId, selectors }
}

function evidence(edgeId: string, source: string, target: string, relation: Exclude<ContractAtlasCheckedRelation, 'assets'>, locations: ContractAtlasEvidenceLocation[]): ContractAtlasSemanticEvidence {
	return { edgeId, locations, relation, source, target }
}

function flow(sender: string, recipient: string, ...locations: ContractAtlasEvidenceLocation[]): ContractAtlasAssetFlowEvidence {
	return { locations, recipient, sender }
}

function assetEvidence(edgeId: string, source: string, target: string, ...assetFlows: ContractAtlasAssetFlowEvidence[]): ContractAtlasSemanticEvidence {
	return { assetFlows, edgeId, locations: [], relation: 'assets', source, target }
}

function claim(phrase: string, ...locations: ContractAtlasEvidenceLocation[]): ContractAtlasSemanticClaimEvidence {
	return { locations, phrase }
}

function inheritedCallClaim(phrase: string, ...locations: ContractAtlasEvidenceLocation[]): ContractAtlasSemanticClaimEvidence {
	return { callSide: 'inherited-source', locations, phrase }
}

function receiverClaim(phrase: string, ...locations: ContractAtlasEvidenceLocation[]): ContractAtlasSemanticClaimEvidence {
	return { callSide: 'receiver', locations, phrase }
}

export const contractAtlasCompatibilityEvidence: Record<string, ContractAtlasCompatibilityEvidence> = {
	'worker-config-interface': {
		members: [
			{
				name: 'factory',
				sourceSelector: 'ISecurityPoolFactory public immutable factory',
				targetSelector: 'function factory() external view returns (ISecurityPoolFactory)',
			},
			{
				name: 'eventEmitter',
				sourceSelector: 'SecurityPoolEventEmitter public immutable eventEmitter',
				targetSelector: 'function eventEmitter() external view returns (SecurityPoolEventEmitter)',
			},
		],
		source: 'statoblast-security-pool-worker',
		target: 'statoblast-deployment-worker-config',
	},
	'weth-interface': {
		members: [
			{ name: 'name', sourceSelector: 'string public name', targetSelector: 'function name() external view returns (string memory)' },
			{ name: 'symbol', sourceSelector: 'string public symbol', targetSelector: 'function symbol() external view returns (string memory)' },
			{ name: 'decimals', sourceSelector: 'uint8 public decimals', targetSelector: 'function decimals() external view returns (uint8)' },
			{ name: 'balanceOf', sourceSelector: 'mapping(address => uint) public balanceOf', targetSelector: 'function balanceOf(address account) external view returns (uint)' },
			{ name: 'allowance', sourceSelector: 'mapping(address => mapping(address => uint)) public allowance', targetSelector: 'function allowance(address owner, address spender) external view returns (uint)' },
			{ name: 'deposit', sourceSelector: 'function deposit() public payable', targetSelector: 'function deposit() external payable' },
			{ name: 'withdraw', sourceSelector: 'function withdraw(uint wad) external', targetSelector: 'function withdraw(uint wad) external' },
			{ name: 'totalSupply', sourceSelector: 'function totalSupply() external view returns (uint)', targetSelector: 'function totalSupply() external view returns (uint)' },
			{ name: 'approve', sourceSelector: 'function approve(address guy, uint wad) external returns (bool)', targetSelector: 'function approve(address guy, uint wad) external returns (bool)' },
			{ name: 'transfer', sourceSelector: 'function transfer(address dst, uint wad) external returns (bool)', targetSelector: 'function transfer(address dst, uint wad) external returns (bool)' },
			{ name: 'transferFrom', sourceSelector: 'function transferFrom(address src, address dst, uint wad) public returns (bool)', targetSelector: 'function transferFrom(address src, address dst, uint wad) external returns (bool)' },
		],
		source: 'infra-weth9',
		target: 'statoblast-iweth9',
	},
}

export const contractAtlasTestExecutionEvidence: Record<string, ContractAtlasTestExecutionEvidence> = {
	'test-complete-set-reentrancy': {
		file: 'solidity/ts/tests/securityRegression.test.ts',
		sourceSelectors: ['test_peripherals_CompleteSetReentrantReceiver_CompleteSetReentrantReceiver.abi'],
		target: 'statoblast-security-pool',
		targetLocations: [location('statoblast-security-pool', 'function createCompleteSet() external payable')],
		targetSelectors: ['peripherals_SecurityPool_SecurityPool.abi'],
	},
	'test-escalation-factory-pool': {
		file: 'solidity/ts/tests/coverageHelpers.test.ts',
		sourceSelectors: ['test_peripherals_CoverageHelpersHarness_EscalationGameFactoryCoverageSecurityPool.abi'],
		target: 'statoblast-escalation-game-factory',
		targetLocations: [location('statoblast-escalation-game-factory', 'function deployEscalationGame(')],
		targetSelectors: ['peripherals_factories_EscalationGameFactory_EscalationGameFactory.abi'],
	},
	'test-non-receiver': {
		file: 'solidity/ts/tests/erc1155.test.ts',
		sourceSelectors: ['test_peripherals_ERC1155ReceiverMock_ERC1155NonReceiver.abi'],
		target: 'statoblast-erc1155',
		targetLocations: [location('statoblast-erc1155', 'function safeTransferFrom(')],
		targetSelectors: ['peripherals_tokens_ShareToken_ShareToken.abi'],
	},
	'test-threshold-zoltar': {
		file: 'solidity/ts/tests/escalationGameForkThreshold.test.ts',
		sourceSelectors: ['test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkBoundaryZoltar.abi'],
		target: 'zoltar-core',
		targetLocations: [location('zoltar-core', 'function getForkThreshold(')],
		targetSelectors: ['Zoltar_Zoltar.abi'],
	},
	'test-threshold-pool': {
		file: 'solidity/ts/tests/escalationGameForkThreshold.test.ts',
		scope: {
			selectors: ['test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkBoundarySecurityPool.abi', 'args: [zoltar]', 'test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkThresholdHarness.abi', 'args: [securityPool, proofVerifier]', "functionName: 'computeWinningWithdrawal'"],
			testName: 'reduced-threshold scaling remains active immediately before and exactly at game end, but not one second after',
		},
		sourceSelectors: ['test_peripherals_EscalationGameForkThresholdHarness_EscalationGameForkBoundarySecurityPool.abi'],
		target: 'statoblast-escalation-calculations',
		targetLocations: [location('statoblast-escalation-calculations', 'function _computeWinningWithdrawal(')],
		targetSelectors: ["functionName: 'computeWinningWithdrawal'"],
	},
	'test-escalation-forker-edge': {
		file: 'solidity/ts/tests/escalationGame.test.ts',
		sourceSelectors: ['escalationGameForkerHarnessArtifact.abi'],
		target: 'statoblast-escalation-game-forker',
		targetLocations: [location('statoblast-escalation-game-forker', 'function claimForkedEscalationDeposits(')],
		targetSelectors: ['peripherals_SecurityPoolForker_SecurityPoolForker.abi'],
	},
	'test-proof-pool-edge': {
		file: 'solidity/ts/tests/escalationGame.test.ts',
		sourceSelectors: ['escalationGameProofTestPoolArtifact.abi'],
		target: 'statoblast-escalation-proof-verifier',
		targetLocations: [location('statoblast-escalation-proof-verifier', 'function computeEmptyNullifierRoot(')],
		targetSelectors: ['peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier.abi'],
	},
	'test-incompatible-verifier-edge': {
		file: 'solidity/ts/tests/escalationGame.test.ts',
		sourceSelectors: ['incompatibleProofVerifierArtifact.abi'],
		target: 'statoblast-escalation-state',
		targetLocations: [location('statoblast-escalation-state', 'function _readEmptyNullifierRoot(', 'codehash == keccak256(type(EscalationGameProofVerifier).runtimeCode)')],
		targetSelectors: ['peripherals_EscalationGame_EscalationGame.abi'],
	},
	'test-openoracle-receiver-edge': {
		file: 'solidity/ts/tests/openOracleDispute.test.ts',
		sourceSelectors: ['rejectingEthReceiverArtifact.abi'],
		target: 'openoracle-core',
		targetLocations: [location('openoracle-core', 'function _withdraw(', '(to).call{ value: amount }(')],
		targetSelectors: ['peripherals_openOracle_OpenOracle_OpenOracle.abi'],
	},
	'test-own-fork-claim-edge': {
		file: 'solidity/ts/tests/peripherals/deploymentAndOwnForkEscalation.test.ts',
		sourceSelectors: ['test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi'],
		target: 'statoblast-escalation-game-forker',
		targetLocations: [location('statoblast-escalation-game-forker', 'function claimForkedEscalationDeposits(')],
		targetSelectors: ['peripherals_SecurityPoolForker_SecurityPoolForker.abi'],
	},
	'test-safe-ops-edge': {
		file: 'solidity/ts/tests/safeErc20.test.ts',
		sourceSelectors: ['test_peripherals_SafeERC20OpsHarness_SafeERC20OpsHarness.abi'],
		target: 'zoltar-safe-erc20-ops',
		targetLocations: [location('zoltar-safe-erc20-ops', 'function safeTransferFrom(')],
		targetSelectors: ["functionName: 'safeTransferFromToken'"],
	},
	'test-ancestor-edge': {
		file: 'solidity/ts/tests/escalationGame.test.ts',
		sourceSelectors: ['securityPoolAncestorTestNodeArtifact.abi'],
		target: 'statoblast-pool-forker',
		targetLocations: [location('statoblast-pool-forker', 'function isEscalationDepositClaimedDirectly(')],
		targetSelectors: ['peripherals_SecurityPoolForker_SecurityPoolForker.abi'],
	},
	'test-constructor-zoltar-edge': {
		file: 'solidity/ts/tests/safeErc20.test.ts',
		sourceSelectors: ['test_peripherals_SecurityPoolConstructorFailureZoltar_SecurityPoolConstructorFailureZoltar.abi'],
		target: 'statoblast-security-pool',
		targetLocations: [location('statoblast-security-pool', 'constructor(')],
		targetSelectors: ['peripherals_factories_SecurityPoolDeployer_SecurityPoolDeploymentWorker.abi'],
	},
	'test-malicious-emitter-edge': {
		file: 'solidity/ts/tests/peripherals/forkMigration.test.ts',
		sourceSelectors: ['test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerMaliciousEventEmitter.abi'],
		target: 'statoblast-event-emitter',
		targetLocations: [location('statoblast-event-emitter', 'function emitForkSnapshotEvents(')],
		targetSelectors: ['peripherals_SecurityPoolForker_SecurityPoolForker.abi', 'initiateSecurityPoolFork('],
	},
	'test-fake-pool-edge': {
		file: 'solidity/ts/tests/peripherals/forkMigration.test.ts',
		sourceSelectors: ['test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerFakePoolMock.abi'],
		target: 'statoblast-security-pool-interface',
		targetLocations: [location('statoblast-security-pool-interface', 'function securityPoolEventEmitter(')],
		targetSelectors: ['peripherals_SecurityPoolForker_SecurityPoolForker.abi', 'initiateSecurityPoolFork('],
	},
	'test-attack-factory-edge': {
		file: 'solidity/ts/tests/peripherals/forkMigration.test.ts',
		sourceSelectors: ['test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackFactoryMock.abi'],
		target: 'statoblast-security-pool-factory-interface',
		targetLocations: [location('statoblast-security-pool-factory-interface', 'function deployChildSecurityPool(')],
		targetSelectors: ['peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi', 'createChildUniverse('],
	},
	'test-attack-parent-edge': {
		file: 'solidity/ts/tests/peripherals/forkMigration.test.ts',
		sourceSelectors: ['test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAttackParentMock.abi'],
		target: 'statoblast-pool-forker',
		targetLocations: [location('statoblast-pool-forker', 'function createChildUniverse(')],
		targetSelectors: ['peripherals_SecurityPoolForker_SecurityPoolForker.abi', 'createChildUniverse('],
	},
	'test-escrow-factory-edge': {
		file: 'solidity/ts/tests/peripherals/forkMigration.test.ts',
		sourceSelectors: ['test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackFactoryMock.abi'],
		target: 'statoblast-security-pool-factory-interface',
		targetLocations: [location('statoblast-security-pool-factory-interface', 'function deployChildSecurityPool(')],
		targetSelectors: ['peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi', 'claimForkedEscalationDeposits('],
	},
	'test-escrow-game-edge': {
		file: 'solidity/ts/tests/peripherals/forkMigration.test.ts',
		sourceSelectors: ['test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackGameMock.abi'],
		target: 'statoblast-escalation-game',
		targetLocations: [location('statoblast-escalation-carry', 'function getForkCarrySnapshot(')],
		targetSelectors: ['peripherals_EscalationGame_EscalationGame.abi', 'claimForkedEscalationDeposits('],
	},
	'test-escrow-parent-edge': {
		file: 'solidity/ts/tests/peripherals/forkMigration.test.ts',
		sourceSelectors: ['test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackParentMock.abi'],
		target: 'statoblast-pool-forker',
		targetLocations: [location('statoblast-pool-forker', 'function claimForkedEscalationDeposits(')],
		targetSelectors: ['peripherals_SecurityPoolForker_SecurityPoolForker.abi', 'claimForkedEscalationDeposits('],
	},
	'test-alternating-game-edge': {
		file: 'solidity/ts/tests/peripherals/forkMigration.test.ts',
		sourceSelectors: ['test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerAlternatingChildGameMock.abi'],
		target: 'statoblast-escalation-game',
		targetLocations: [location('statoblast-escalation-carry', 'function getForkCarrySnapshot(')],
		targetSelectors: ['peripherals_EscalationGame_EscalationGame.abi', 'finalizeEscalationStateAfterAuction'],
	},
	'test-escrow-child-edge': {
		file: 'solidity/ts/tests/peripherals/forkMigration.test.ts',
		sourceSelectors: ['test_peripherals_SecurityPoolForkerAttackMocks_SecurityPoolForkerEscrowAttackChildMock.abi'],
		target: 'statoblast-security-pool',
		targetLocations: [location('statoblast-security-pool', 'function initializeForkedEscalationGame(')],
		targetSelectors: ['peripherals_SecurityPool_SecurityPool.abi', 'migrateVaultWithUnresolvedEscalation('],
	},
	'test-auction-pool-edge': {
		file: 'solidity/ts/tests/peripherals/truthAuction.test.ts',
		sourceSelectors: ['test_peripherals_SecurityPoolForkerAuctionSettlementHarness_AuctionSettlementPoolHarness.evm.bytecode.object'],
		target: 'statoblast-security-pool',
		targetLocations: [location('statoblast-security-pool', 'function configureVault(')],
		targetSelectors: ['peripherals_SecurityPool_SecurityPool.abi'],
	},
}

// Every direct-call meaning is decomposed into source-linked claims. A claim's
// phrase must occur verbatim in the rendered meaning, while its selectors pin
// that phrase to the implementation operations that make it true.
export const contractAtlasCallClaimEvidence: Record<string, ContractAtlasSemanticClaimEvidence[]> = {
	'zoltar-core-question-data': [claim('fork questions', location('zoltar-core', 'zoltarQuestionData.questionCreatedTimestamp(')), claim('end times', location('zoltar-core', 'zoltarQuestionData.getQuestionEndDate(')), claim('child outcomes', location('zoltar-core', 'zoltarQuestionData.isMalformedAnswerOption('))],
	'factory-question-data': [claim('existing Yes/No question', location('statoblast-security-pool-factory', 'questionData.questionCreatedTimestamp(', 'questionData.getOutcomeLabels('))],
	'factory-zoltar': [
		claim('universe', location('statoblast-security-pool-factory', 'zoltar.forkQuestionMatches(')),
		claim('REP', location('statoblast-security-pool-factory', 'zoltar.getRepToken(')),
		claim('fork', location('statoblast-security-pool-factory', 'zoltar.getForkTime(')),
		claim('non-decision-threshold', location('statoblast-security-pool-factory', 'zoltar.getNonDecisionThreshold(')),
	],
	'factory-share-factory': [claim('origin lineage share token', location('statoblast-security-pool-factory', 'shareTokenFactory.deployShareToken('))],
	'factory-share-token': [claim('Authorizes', location('statoblast-security-pool-factory', 'shareToken.authorize('))],
	'factory-price-factory': [claim('REP/WETH price coordinator', location('statoblast-security-pool-factory', '.deployPriceOracleManagerAndOperatorQueuer('))],
	'factory-price-coordinator': [claim('Permanently binds', location('statoblast-security-pool-factory', 'priceOracleManagerAndOperatorQueuer.setSecurityPool('))],
	'factory-auction-factory': [claim('truth auction', location('statoblast-security-pool-factory', 'uniformPriceDualCapBatchAuctionFactory.deployUniformPriceDualCapBatchAuction('))],
	'factory-pool-deployer-call': [claim('private deployer', location('statoblast-security-pool-factory', 'securityPoolDeployer.deploy('))],
	'escalation-factory-pool': [
		claim('calling pool', location('statoblast-escalation-game-factory', 'ISecurityPool securityPool = ISecurityPool(payable(msg.sender))')),
		claim('parent', location('statoblast-escalation-game-factory', 'ISecurityPool parent = child.parent()')),
		claim('REP token', location('statoblast-escalation-game-factory', 'securityPool.repToken(')),
		claim('shared forker configuration', location('statoblast-escalation-game-factory', 'child.securityPoolForker(')),
	],
	'escalation-factory-forker': [claim('own-fork haircut', location('statoblast-escalation-game-factory', 'isEscalationWinnerHaircutPaidByFork(')), claim('REP-bucket state', location('statoblast-escalation-game-factory', 'getOwnForkRepBuckets('))],
	'pool-worker-config': [claim('factory', location('statoblast-security-pool', 'worker.factory(')), claim('event-emitter', location('statoblast-security-pool', 'worker.eventEmitter('))],
	'pool-share-token': [
		claim('Mints', location('statoblast-security-pool', 'shareToken.mintCompleteSets(')),
		claim('burns complete sets', location('statoblast-security-pool', 'shareToken.burnCompleteSets(')),
		claim('redeems winning shares', location('statoblast-security-pool', 'shareToken.burnTokenIdAndGetRemainingSupply(')),
		claim('authorizes child pools', location('statoblast-security-pool', 'shareToken.authorize(')),
	],
	'pool-escalation-factory': [
		claim('Lazily deploys a local game on the first deposit', location('statoblast-security-pool', 'if (address(escalationGame) == address(0x0))', 'escalationGameFactory.deployEscalationGame(')),
		claim('deploys a fork-continuation game when the forker initializes inherited state', location('statoblast-security-pool', 'function initializeForkedEscalationGame(', 'external onlyForker', 'escalationGameFactory.deployEscalationGameFromFork(')),
	],
	'pool-price-coordinator': [claim('cached REP/ETH prices', location('statoblast-security-pool', 'priceOracleManagerAndOperatorQueuer.isPriceValid(', 'priceOracleManagerAndOperatorQueuer.lastPrice('))],
	'price-coordinator-pool': [
		claim('liquidation', location('statoblast-price-coordinator', 'securityPool.performLiquidation(')),
		claim('withdrawal', location('statoblast-price-coordinator', 'securityPool.performWithdrawRep(')),
		claim('allowance operations', location('statoblast-price-coordinator', 'securityPool.performSetSecurityBondsAllowance(')),
		receiverClaim('coordinator-only pool entrypoints', location('statoblast-security-pool', 'modifier onlyValidOracle()', 'msg.sender == address(priceOracleManagerAndOperatorQueuer)')),
	],
	'openoracle-price-callback': [
		claim('Calls openOracleCallback', location('openoracle-core', 'bytes4 internal constant CALLBACK_SELECTOR = bytes4(', 'callbackContract.call{ gas: callbackGasLimit }(')),
		receiverClaim('configured coordinator', location('statoblast-price-coordinator', 'callbackContract: address(this)')),
	],
	'share-token-zoltar': [claim('Derives child universes', location('statoblast-share-token', 'uint248 targetUniverseId = getChildUniverseId(')), claim('inspects fork state', location('statoblast-share-token', 'zoltar.getForkTime(', 'zoltar.universes('))],
	'share-token-pool': [claim('source', location('statoblast-share-token', 'sourcePool.systemState(')), claim('candidate canonical pools', location('statoblast-share-token', 'targetPool.parent('))],
	'share-token-forker': [claim('Activates the source fork', location('statoblast-share-token', 'forker.initiateSecurityPoolFork(')), claim('lazily creates child pools', location('statoblast-share-token', 'forker.createChildUniverse('))],
	'erc1155-receiver': [claim('single', location('statoblast-erc1155', 'IERC1155Receiver(to).onERC1155Received(')), claim('batch receiver callbacks', location('statoblast-erc1155', 'IERC1155Receiver(to).onERC1155BatchReceived('))],
	'pool-forker-runtime': [claim('resolved question outcomes', location('statoblast-security-pool', 'ISecurityPoolForker(securityPoolForker).getQuestionOutcome('))],
	'pool-zoltar-runtime': [claim('fork timing', location('statoblast-security-pool', 'zoltar.getForkTime(')), claim('burns resolution haircuts', location('statoblast-security-pool', 'zoltar.burnRep('))],
	'pool-question-runtime': [claim('market question end date', location('statoblast-security-pool', 'questionData.getQuestionEndDate('))],
	'deposit-delegate-context': [claim('active game context', location('statoblast-escalation-deposit-delegate', 'IEscalationGameDepositContext(address(this)).hasReachedNonDecision('))],
	'state-proof-verifier': [claim('Pins', location('statoblast-escalation-state', 'proofVerifier = _proofVerifier', 'codehash == keccak256(type(EscalationGameProofVerifier).runtimeCode)')), claim('reads', location('statoblast-escalation-state', '_proofVerifier.computeEmptyNullifierRoot('))],
	'carry-proof-verifier': [claim('Merkle Mountain Range', location('statoblast-escalation-carry', 'proofVerifier.computeMerkleMountainRangeRootFromProof(', 'proofVerifier.bagCarryPeaks(')), claim('nullifier proofs', location('statoblast-escalation-carry', 'proofVerifier.computeNullifierRoot('))],
	'escalation-settlement-pool': [claim('Returns residual REP', location('statoblast-escalation-settlement', '_safeTransferRep(address(securityPool), amount)')), claim('asks the pool to burn winner haircuts', location('statoblast-escalation-settlement', 'securityPool.burnEscalationWinnerHaircut('))],
	'escalation-settlement-forker': [
		claim('direct own-fork claim lineage', location('statoblast-escalation-settlement', 'ISecurityPoolForker(securityPool.securityPoolForker()).isEscalationDepositClaimedDirectly(')),
		claim('question outcomes', location('statoblast-escalation-settlement', 'ISecurityPoolForker(securityPool.securityPoolForker()).getQuestionOutcome(')),
	],
	'proxy-zoltar': [claim('literal Zoltar migration ledger balance', location('statoblast-migration-proxy', 'zoltar.addRepToMigrationBalance(', 'zoltar.forkUniverse(', 'zoltar.splitMigrationRep('))],
	'forker-zoltar': [claim('fork thresholds', location('statoblast-pool-forker', 'zoltar.getForkThreshold(')), claim('migration balances', location('statoblast-pool-forker', 'zoltar.getMigrationRepBalance('))],
	'forker-pool': [
		claim('Freezes parents', location('statoblast-pool-forker', 'securityPool.activateForkMode(')),
		claim('migrates children', location('statoblast-pool-forker', 'securityPool.setSystemState(SystemState.ForkTruthAuction)', 'securityPool.updateCollateralAmount(')),
		claim('updates collateral', location('statoblast-pool-forker', 'securityPool.configureVault(')),
		claim('ownership accounting', location('statoblast-pool-forker', 'securityPool.setOwnershipDenominator(')),
		receiverClaim('forker-only pool entrypoints', location('statoblast-security-pool', 'modifier onlyForker()', 'require(msg.sender == securityPoolForker,')),
	],
	'forker-game': [
		claim('Snapshots escalation state', location('statoblast-pool-forker', 'escalationGame.getForkCarrySnapshot(', 'escalationGame.getForkCarryRoots(')),
		claim('resolves inherited question outcomes', location('statoblast-pool-forker', 'escalationGame.getOutcomeBalances(', 'escalationGame.getFinalQuestionResolution(')),
	],
	'vault-base-zoltar': [claim('Deploys missing child universes', location('statoblast-vault-migration-base', 'zoltar.deployChild(')), claim('reads child REP', location('statoblast-vault-migration-base', 'zoltar.getRepToken('))],
	'vault-base-factory': [claim('canonical child-pool deployment', location('statoblast-vault-migration-base', 'parent.securityPoolFactory().deployChildSecurityPool('))],
	'vault-base-pool': [claim('Copies vault, collateral, and ownership state', location('statoblast-vault-migration-base', 'child.configureVault(', 'parent.configureVault(', 'child.setOwnershipDenominator(', 'parent.transferEth('))],
	'escalation-forker-child-interface': [claim('Initializes child escalation carry snapshots', location('statoblast-escalation-game-forker', 'ISecurityPoolForkerChildEscalationGameInitializer(address(this)).initializeChildForkedEscalationGameIfNeeded('))],
	'escalation-forker-game': [
		claim('Exports', location('statoblast-escalation-game-forker', 'parentEscalationGame.exportForkedEscrowByOutcomeWithoutTransfer(', 'parentEscalationGame.exportVaultUnresolvedTotalsWithoutTransfer(')),
		claim('materializes', location('statoblast-escalation-game-forker', 'childEscalationGame.recordForkedEscrowForOutcome(')),
		claim('resumes', location('statoblast-escalation-game-forker', '_finalizeAwaitingForkContinuationIfReady(')),
		claim('settles forked escalation state', location('statoblast-escalation-game-forker', 'escalationGame.claimDepositForWinningWithoutTransfer(')),
	],
	'escalation-forker-pool': [claim('Updates child pool escalation accounting', location('statoblast-escalation-game-forker', 'parent.configureVault(', 'child.systemState('))],
	'escalation-forker-zoltar': [inheritedCallClaim('universe', location('statoblast-vault-migration-base', 'zoltar.deployChild(')), inheritedCallClaim('REP relationships', location('statoblast-vault-migration-base', 'zoltar.getRepToken('))],
	'openoracle-permit2': [claim('Permit2 singleton', location('openoracle-core', 'ISignatureTransfer(PERMIT2).permitWitnessTransferFrom('))],
	'test-share-authorization': [claim('adding a canonical child', location('test-share-token-authorization-pool', 'shareToken.authorize('))],
}

export const contractAtlasUseClaimEvidence: Record<string, ContractAtlasSemanticClaimEvidence[]> = {
	'zoltar-question-scalar': [claim('Decodes and names scalar outcomes', location('zoltar-question-data', 'ScalarOutcomes.getScalarOutcomeName('))],
	'zoltar-core-constants': [claim('protocol addresses', location('zoltar-core', 'Constants.GENESIS_REPUTATION_TOKEN')), claim('fork limits', location('zoltar-core', 'Constants.MINIMUM_FORK_BURN_DIVISOR'))],
	'zoltar-core-safe-erc20': [claim('checked ERC-20 calls', location('zoltar-core', 'using SafeERC20Ops for IERC20'))],
	'zoltar-core-ierc20': [claim('repository ERC-20 interface', location('zoltar-core', 'IERC20(address(reputationToken)).safeTransfer('))],
	'zoltar-safe-ops-interface': [claim('return-data checks', location('zoltar-safe-erc20-ops', 'abi.encodeCall(IERC20.transfer,', 'abi.encodeCall(IERC20.transferFrom,', 'abi.encodeCall(IERC20.approve,'))],
	'share-factory-zoltar': [claim('shared Zoltar registry', location('statoblast-share-token-factory', 'Zoltar immutable zoltar'))],
	'price-factory-weth': [claim('immutable WETH contract', location('statoblast-price-coordinator-factory', 'IWeth9 public immutable weth'))],
	'price-coordinator-pool-utils': [claim('BPS', location('statoblast-price-coordinator', 'SecurityPoolUtils.BPS_DENOMINATOR')), claim('minimum-REP constants', location('statoblast-price-coordinator', 'SecurityPoolUtils.MIN_REP_DEPOSIT'))],
	'price-coordinator-math': [claim('report funding', location('statoblast-price-coordinator', 'Math.mulDiv(initialWethReport,')), claim('risk thresholds', location('statoblast-price-coordinator', 'Math.ceilDiv(securityPool.completeSetCollateralAmount('))],
	'price-coordinator-stored-game': [claim('OpenOracle stored-game data', location('statoblast-price-coordinator', 'IStoredOpenOracleGame(address(openOracle)).storedGame('))],
	'share-token-token-id': [claim('Packs', location('statoblast-share-token', 'TokenId.getTokenId(')), claim('unpacks universe and outcome identifiers', location('statoblast-share-token', 'TokenId.unpackTokenId('))],
	'share-token-binary-outcomes': [claim('Invalid', location('statoblast-share-token', 'BinaryOutcomes.BinaryOutcome.Invalid')), claim('Yes', location('statoblast-share-token', 'BinaryOutcomes.BinaryOutcome.Yes')), claim('No token IDs', location('statoblast-share-token', 'BinaryOutcomes.BinaryOutcome.No'))],
	'pool-utils-runtime': [
		claim('fee', location('statoblast-security-pool', 'SecurityPoolUtils.calculateRetentionRate(', 'SecurityPoolUtils.calculateVaultFee(')),
		claim('precision', location('statoblast-security-pool', 'SecurityPoolUtils.PRICE_PRECISION')),
		claim('minimum-REP constants', location('statoblast-security-pool', 'SecurityPoolUtils.MIN_REP_DEPOSIT')),
	],
	'pool-binary-outcomes': [claim('canonical Invalid/Yes/No outcome enum', location('statoblast-security-pool', 'BinaryOutcomes.BinaryOutcome.None'))],
	'deposit-delegate-mmr': [claim('Appends canonical carry leaves', location('statoblast-escalation-deposit-delegate', 'MerkleMountainRange.hashLeaf(', 'MerkleMountainRange.hashParent('))],
	'proof-verifier-mmr': [claim('carry roots', location('statoblast-escalation-proof-verifier', 'MerkleMountainRange.bagPeaks(')), claim('proof paths', location('statoblast-escalation-proof-verifier', 'MerkleMountainRange.hashParent('))],
	'escalation-types-storage': [
		claim(
			'outcome, deposit, node, and fork-escrow structures',
			location('statoblast-escalation-storage', 'OutcomeState[3] internal outcomeState', 'mapping(uint256 => Node) public nodes', 'mapping(address => mapping(uint8 => ForkedEscrowState)) internal forkedEscrowByVaultAndOutcome'),
			location('statoblast-escalation-types', 'Deposit[] deposits'),
		),
	],
	'escalation-types-carry': [claim('carry', location('statoblast-escalation-carry', 'CarryLeafView[] memory carryLeaves')), claim('proof structures', location('statoblast-escalation-carry', 'CarriedDepositProof calldata proof'))],
	'escalation-binary-calculations': [claim('question-resolution results', location('statoblast-escalation-calculations', 'returns (BinaryOutcomes.BinaryOutcome outcome)')), claim('unresolved sentinels', location('statoblast-escalation-calculations', 'BinaryOutcomes.BinaryOutcome.None'))],
	'auction-math': [claim('clearing', location('statoblast-truth-auction', 'underfundedThreshold = Math.mulDiv(')), claim('pro-rata settlement', location('statoblast-truth-auction', 'uint256 cumulativeAllocationBefore = Math.mulDiv('))],
	'vault-base-types': [claim('fork', location('statoblast-vault-migration-base', 'SecurityPoolForkerForkData storage childData')), claim('child-REP allocation records', location('statoblast-vault-migration-base', 'OwnForkChildRepAllocation storage allocated'))],
	'forker-storage-types': [claim('typed per-pool fork and migration mappings', location('statoblast-forker-storage', 'mapping(ISecurityPool => SecurityPoolForkerForkData) internal forkDataByPool'))],
	'forker-utils': [claim('auction timing', location('statoblast-pool-forker', 'SecurityPoolUtils.MIGRATION_TIME', 'SecurityPoolUtils.AUCTION_TIME')), claim('fixed-point precision', location('statoblast-pool-forker', 'SecurityPoolUtils.PRICE_PRECISION'))],
	'forker-binary': [claim('fixed', location('statoblast-pool-forker', 'BinaryOutcomes.BinaryOutcome(data.fixedQuestionOutcomePlusOne - 1)')), claim('unresolved binary outcomes', location('statoblast-pool-forker', 'BinaryOutcomes.BinaryOutcome.None'))],
	'openoracle-errors-edge': [claim('custom-error catalog', location('openoracle-core', 'Errors.InvalidMode('))],
	'openoracle-erc20-edge': [claim('imported ERC-20 interface', location('openoracle-core', 'IERC20(token).safeTransferFrom('))],
	'openoracle-safe-erc20-edge': [claim('OpenZeppelin safe wrappers', location('openoracle-core', 'using SafeERC20 for IERC20'))],
	'safe-erc20-interface': [claim('transfers', location('openoracle-safe-erc20', 'function safeTransfer(IERC20 token,', 'function safeTransferFrom(IERC20 token,')), claim('approvals', location('openoracle-safe-erc20', 'function safeIncreaseAllowance(IERC20 token,'))],
	'safe-erc20-1363': [claim('relaxed ERC-1363 transfer-and-call helpers', location('openoracle-safe-erc20', 'function transferAndCallRelaxed(IERC1363 token,'))],
	'math-panic': [claim('division and overflow panics', location('openoracle-math', 'Panic.panic('))],
	'math-safe-cast': [claim('comparison results', location('openoracle-math', 'SafeCast.toUint('))],
}

export const contractAtlasSemanticMeanings: Record<string, string> = {
	'zoltar-question-scalar': 'Decodes and names scalar outcomes with the shared scalar library.',
	'zoltar-core-constants': 'Reads protocol addresses and fork limits.',
	'zoltar-core-safe-erc20': 'Moves genesis REP through checked ERC-20 calls.',
	'zoltar-core-ierc20': 'Treats genesis REP as the repository ERC-20 interface.',
	'zoltar-core-question-data': 'Validates fork questions, end times, and child outcomes.',
	'zoltar-safe-ops-interface': 'Wraps repository ERC-20 calls with return-data checks.',
	'factory-question-data': 'Validates that origin markets use an existing Yes/No question.',
	'factory-zoltar': 'Reads universe, REP, fork, and non-decision-threshold state.',
	'factory-share-factory': 'Requests the origin lineage share token.',
	'factory-share-token': 'Authorizes the newly deployed origin pool on its lineage share token.',
	'share-factory-zoltar': 'Wires the shared Zoltar registry into every deployed share token.',
	'factory-price-factory': 'Requests one REP/WETH price coordinator per pool.',
	'price-factory-weth': 'Wires its immutable WETH contract into each coordinator.',
	'factory-price-coordinator': 'Permanently binds the newly deployed coordinator to its canonical pool.',
	'factory-auction-factory': 'Requests a truth auction for each child pool.',
	'factory-pool-deployer-call': 'Calls the private deployer for every origin or child pool after assembling its dependencies.',
	'worker-config-interface': 'Structurally provides the factory and event-emitter getters read through the pool constructor interface.',
	'escalation-factory-pool': 'Reads the calling pool, parent, REP token, and shared forker configuration.',
	'escalation-factory-forker': 'Reads own-fork haircut and REP-bucket state for child continuations.',
	'pool-worker-config': 'Reads its factory and event-emitter wiring from the deployment worker.',
	'pool-reputation-token': 'Uses REP token calls to move REP vault or reporter → pool, pool → escalation game or forker, and pool → redemption recipient.',
	'pool-share-token': 'Mints and burns complete sets, redeems winning shares, and authorizes child pools.',
	'pool-escalation-factory': 'Lazily deploys a local game on the first deposit, or deploys a fork-continuation game when the forker initializes inherited state.',
	'pool-escalation-game': 'Reads resolution state while reporting REP moves pool → game escrow and settled REP moves game → pool or claimant.',
	'pool-price-coordinator': 'Reads cached REP/ETH prices.',
	'price-coordinator-pool': 'Executes staged liquidation, withdrawal, and allowance operations through coordinator-only pool entrypoints after validation.',
	'price-coordinator-openoracle': 'Funds reports with WETH and REP coordinator → OpenOracle, then requests settled balances OpenOracle → sponsor.',
	'openoracle-price-callback': 'Calls openOracleCallback on the configured coordinator after report settlement.',
	'price-coordinator-weth': 'Calls WETH to move sponsor → coordinator, grants coordinator → OpenOracle allowance, and requests settled WETH OpenOracle → sponsor.',
	'price-coordinator-rep': 'Calls REP to move sponsor → coordinator, grants coordinator → OpenOracle allowance, and requests settled REP OpenOracle → sponsor.',
	'price-coordinator-pool-utils': 'Uses shared BPS and minimum-REP constants.',
	'price-coordinator-math': 'Uses checked rounding for report funding and risk thresholds.',
	'price-coordinator-stored-game': 'Uses a narrow compatibility view of OpenOracle stored-game data.',
	'share-token-token-id': 'Packs and unpacks universe and outcome identifiers.',
	'share-token-binary-outcomes': 'Maps each universe to Invalid, Yes, and No token IDs.',
	'share-token-zoltar': 'Derives child universes and inspects fork state.',
	'share-token-pool': 'Validates source and candidate canonical pools during migration and authorization.',
	'share-token-forker': 'Activates the source fork and lazily creates child pools during share migration.',
	'erc1155-receiver': 'Performs safe single and batch receiver callbacks.',
	'pool-forker-runtime': 'Reads resolved question outcomes from the shared forker.',
	'pool-zoltar-runtime': 'Reads universe fork timing and burns resolution haircuts through Zoltar.',
	'pool-question-runtime': 'Reads the market question end date.',
	'pool-utils-runtime': 'Uses shared fee, precision, and minimum-REP constants.',
	'pool-binary-outcomes': 'Uses the canonical Invalid/Yes/No outcome enum.',
	'deposit-delegate-context': 'Calls back into the active game context for view calculations.',
	'deposit-delegate-mmr': 'Appends canonical carry leaves.',
	'state-proof-verifier': 'Pins and reads the storage-free proof verifier.',
	'state-reputation-token': 'Uses REP token calls to move game escrow → claimant, pool, or fork export recipient.',
	'carry-proof-verifier': 'Verifies Merkle Mountain Range and nullifier proofs.',
	'proof-verifier-mmr': 'Computes carry roots and proof paths.',
	'escalation-types-storage': 'Stores the shared outcome, deposit, node, and fork-escrow structures.',
	'escalation-types-carry': 'Consumes the shared carry and proof structures.',
	'escalation-binary-calculations': 'Types question-resolution results and unresolved sentinels with the shared binary-outcome enum.',
	'escalation-settlement-pool': 'Returns residual REP and asks the pool to burn winner haircuts.',
	'escalation-settlement-forker': 'Checks direct own-fork claim lineage and question outcomes.',
	'auction-math': 'Uses full-precision arithmetic for clearing and pro-rata settlement.',
	'forker-proxy-assets': 'Transfers parent REP forker → migration proxy, then instructs the proxy to lock, fork, split, and sweep child REP.',
	'forker-reputation-token': 'Calls the parent REP token to transfer REP forker → stable migration proxy.',
	'proxy-zoltar': 'Owns the literal Zoltar migration ledger balance for one parent pool.',
	'proxy-reputation-token': 'Calls REP to grant proxy → Zoltar allowance and transfer minted child REP proxy → configured receiver.',
	'forker-zoltar': 'Reads fork thresholds and migration balances around proxy operations.',
	'forker-pool': 'Freezes parents, migrates children, and updates collateral and ownership accounting through forker-only pool entrypoints.',
	'forker-game': 'Snapshots escalation state and resolves inherited question outcomes.',
	'forker-auction': 'Coordinates ETH bidder → auction → forker → child pool or, for refunds, auction → bidder; purchased REP is credited as pool ownership rather than transferred.',
	'vault-base-zoltar': 'Deploys missing child universes and reads child REP.',
	'vault-base-factory': 'Requests canonical child-pool deployment.',
	'vault-base-pool': 'Copies vault, collateral, and ownership state into child pools.',
	'vault-base-proxy': 'Calls the proxy so split child REP moves migration proxy → child pools and escalation games.',
	'vault-base-types': 'Stores and mutates typed fork and child-REP allocation records.',
	'forker-storage-types': 'Owns the typed per-pool fork and migration mappings.',
	'escalation-forker-child-interface': 'Initializes child escalation carry snapshots through the narrow child API.',
	'escalation-forker-game': 'Exports, materializes, resumes, and settles forked escalation state.',
	'escalation-forker-pool': 'Updates child pool escalation accounting.',
	'escalation-forker-zoltar': 'Reads universe and REP relationships during escalation migration.',
	'forker-utils': 'Uses shared auction timing and fixed-point precision.',
	'forker-binary': 'Tracks fixed and unresolved binary outcomes.',
	'weth-interface': 'Structurally provides the WETH surface consumed through the coordinator interface.',
	'openoracle-errors-edge': 'Uses the imported custom-error catalog.',
	'openoracle-permit2': 'Pulls permit-authorized tokens through the canonical Permit2 singleton.',
	'openoracle-erc20-edge': 'Models report tokens through the imported ERC-20 interface.',
	'openoracle-safe-erc20-edge': 'Moves report tokens through OpenZeppelin safe wrappers.',
	'safe-erc20-interface': 'Wraps imported ERC-20 transfers and approvals.',
	'safe-erc20-1363': 'Supports relaxed ERC-1363 transfer-and-call helpers.',
	'math-panic': 'Reports arithmetic division and overflow panics.',
	'math-safe-cast': 'Converts comparison results for branchless arithmetic.',
	'test-complete-set-reentrancy': 'Exercises complete-set receiver reentrancy.',
	'test-escalation-factory-pool': 'Acts as a minimal pool caller for factory coverage.',
	'test-non-receiver': 'Exercises transfers to a contract without receiver support.',
	'test-share-authorization': 'Models an authorized pool adding a canonical child.',
	'test-threshold-zoltar': 'Supplies controlled fork thresholds for boundary tests.',
	'test-threshold-pool': 'Supplies controlled pool state to fork-threshold calculation tests.',
	'test-escalation-forker-edge': 'Relays escalation-forker calls for authorization tests.',
	'test-proof-pool-edge': 'Provides pool-shaped proof and carry test state.',
	'test-incompatible-verifier-edge': 'Exercises the game-state constructor proof-verifier code-hash rejection.',
	'test-openoracle-receiver-edge': 'Exercises rejected, gas-consuming, and reentrant ETH delivery.',
	'test-own-fork-claim-edge': 'Relays direct own-fork escalation claims.',
	'test-safe-ops-edge': 'Exposes checked transfer and transferFrom wrappers.',
	'test-ancestor-edge': 'Builds controlled pool ancestry graphs for direct-claim replay checks.',
	'test-constructor-zoltar-edge': 'Returns malformed Zoltar constructor dependencies.',
	'test-malicious-emitter-edge': 'Models a layout-incompatible or reverting event delegate.',
	'test-fake-pool-edge': 'Models forged child pool configuration.',
	'test-attack-factory-edge': 'Returns malicious child deployments.',
	'test-attack-parent-edge': 'Models a parent pool that redirects child deployment.',
	'test-escrow-factory-edge': 'Builds escrow-accounting attack children.',
	'test-escrow-game-edge': 'Models inconsistent escalation escrow state.',
	'test-escrow-parent-edge': 'Models malicious parent escalation migration state.',
	'test-alternating-game-edge': 'Alternates child game answers across validation reads.',
	'test-escrow-child-edge': 'Models a malicious child pool during escrow migration.',
	'test-auction-pool-edge': 'Provides controlled auction settlement accounting.',
}

export const contractAtlasSemanticEvidence: ContractAtlasSemanticEvidence[] = [
	// Runtime calls. Selectors are checked inside the named declaration rather than
	// merely accepting that both endpoint nodes exist.
	evidence('zoltar-core-question-data', 'zoltar-core', 'zoltar-question-data', 'calls', [location('zoltar-core', 'zoltarQuestionData.getQuestionEndDate(')]),
	evidence('factory-question-data', 'statoblast-security-pool-factory', 'zoltar-question-data', 'calls', [location('statoblast-security-pool-factory', 'questionData.getOutcomeLabels(')]),
	evidence('factory-zoltar', 'statoblast-security-pool-factory', 'zoltar-core', 'calls', [location('statoblast-security-pool-factory', 'zoltar.getNonDecisionThreshold(')]),
	evidence('factory-share-factory', 'statoblast-security-pool-factory', 'statoblast-share-token-factory', 'calls', [location('statoblast-security-pool-factory', 'shareTokenFactory.deployShareToken(')]),
	evidence('factory-share-token', 'statoblast-security-pool-factory', 'statoblast-share-token', 'calls', [location('statoblast-security-pool-factory', 'shareToken.authorize(')]),
	evidence('factory-price-factory', 'statoblast-security-pool-factory', 'statoblast-price-coordinator-factory', 'calls', [location('statoblast-security-pool-factory', '.deployPriceOracleManagerAndOperatorQueuer(')]),
	evidence('factory-price-coordinator', 'statoblast-security-pool-factory', 'statoblast-price-coordinator', 'calls', [location('statoblast-security-pool-factory', 'priceOracleManagerAndOperatorQueuer.setSecurityPool(')]),
	evidence('factory-auction-factory', 'statoblast-security-pool-factory', 'statoblast-auction-factory', 'calls', [location('statoblast-security-pool-factory', 'uniformPriceDualCapBatchAuctionFactory.deployUniformPriceDualCapBatchAuction(')]),
	evidence('factory-pool-deployer-call', 'statoblast-security-pool-factory', 'statoblast-security-pool-deployer', 'calls', [location('statoblast-security-pool-factory', 'securityPoolDeployer.deploy(')]),
	evidence('escalation-factory-pool', 'statoblast-escalation-game-factory', 'statoblast-security-pool-interface', 'calls', [location('statoblast-escalation-game-factory', 'securityPool.repToken(')]),
	evidence('escalation-factory-forker', 'statoblast-escalation-game-factory', 'statoblast-forker-interface', 'calls', [location('statoblast-escalation-game-factory', 'ISecurityPoolForker(child.securityPoolForker()).getOwnForkRepBuckets(')]),
	evidence('pool-worker-config', 'statoblast-security-pool', 'statoblast-deployment-worker-config', 'calls', [location('statoblast-security-pool', 'worker.factory(', 'worker.eventEmitter(')]),
	evidence('pool-share-token', 'statoblast-security-pool', 'statoblast-share-token', 'calls', [location('statoblast-security-pool', 'shareToken.mintCompleteSets(', 'shareToken.burnCompleteSets(', 'shareToken.authorize(')]),
	evidence('pool-escalation-factory', 'statoblast-security-pool', 'statoblast-escalation-game-factory', 'calls', [
		location('statoblast-security-pool', 'if (address(escalationGame) == address(0x0))', 'function initializeForkedEscalationGame(', 'external onlyForker', 'escalationGameFactory.deployEscalationGame(', 'escalationGameFactory.deployEscalationGameFromFork('),
	]),
	evidence('pool-price-coordinator', 'statoblast-security-pool', 'statoblast-price-coordinator', 'calls', [location('statoblast-security-pool', 'priceOracleManagerAndOperatorQueuer.isPriceValid(', 'priceOracleManagerAndOperatorQueuer.lastPrice(')]),
	evidence('price-coordinator-pool', 'statoblast-price-coordinator', 'statoblast-security-pool', 'calls', [location('statoblast-price-coordinator', 'securityPool.performLiquidation(', 'securityPool.performWithdrawRep(', 'securityPool.performSetSecurityBondsAllowance(')]),
	evidence('openoracle-price-callback', 'openoracle-core', 'statoblast-price-coordinator', 'calls', [location('openoracle-core', 'callbackContract.call{ gas: callbackGasLimit }(')]),
	evidence('share-token-zoltar', 'statoblast-share-token', 'zoltar-core', 'calls', [location('statoblast-share-token', 'zoltar.getForkTime(')]),
	evidence('share-token-pool', 'statoblast-share-token', 'statoblast-security-pool-interface', 'calls', [location('statoblast-share-token', 'sourcePool.systemState(', 'targetPool.parent(')]),
	evidence('share-token-forker', 'statoblast-share-token', 'statoblast-pool-forker', 'calls', [location('statoblast-share-token', 'forker.initiateSecurityPoolFork(', 'forker.createChildUniverse(')]),
	evidence('erc1155-receiver', 'statoblast-erc1155', 'statoblast-ierc1155-receiver', 'calls', [location('statoblast-erc1155', 'IERC1155Receiver(to).onERC1155Received(', 'IERC1155Receiver(to).onERC1155BatchReceived(')]),
	evidence('pool-forker-runtime', 'statoblast-security-pool', 'statoblast-pool-forker', 'calls', [location('statoblast-security-pool', 'ISecurityPoolForker(securityPoolForker).getQuestionOutcome(')]),
	evidence('pool-zoltar-runtime', 'statoblast-security-pool', 'zoltar-core', 'calls', [location('statoblast-security-pool', 'zoltar.burnRep(')]),
	evidence('pool-question-runtime', 'statoblast-security-pool', 'zoltar-question-data', 'calls', [location('statoblast-security-pool', 'questionData.getQuestionEndDate(')]),
	evidence('deposit-delegate-context', 'statoblast-escalation-deposit-delegate', 'statoblast-escalation-deposit-context', 'calls', [location('statoblast-escalation-deposit-delegate', 'IEscalationGameDepositContext(address(this)).hasReachedNonDecision(')]),
	evidence('state-proof-verifier', 'statoblast-escalation-state', 'statoblast-escalation-proof-verifier', 'calls', [location('statoblast-escalation-state', '_proofVerifier.computeEmptyNullifierRoot(')]),
	evidence('carry-proof-verifier', 'statoblast-escalation-carry', 'statoblast-escalation-proof-verifier', 'calls', [location('statoblast-escalation-carry', 'proofVerifier.computeMerkleMountainRangeRootFromProof(')]),
	evidence('escalation-settlement-pool', 'statoblast-escalation-settlement', 'statoblast-security-pool', 'calls', [location('statoblast-escalation-settlement', 'securityPool.burnEscalationWinnerHaircut(')]),
	evidence('escalation-settlement-forker', 'statoblast-escalation-settlement', 'statoblast-forker-interface', 'calls', [location('statoblast-escalation-settlement', 'ISecurityPoolForker(securityPool.securityPoolForker()).isEscalationDepositClaimedDirectly(')]),
	evidence('proxy-zoltar', 'statoblast-migration-proxy', 'zoltar-core', 'calls', [location('statoblast-migration-proxy', 'zoltar.addRepToMigrationBalance(', 'zoltar.forkUniverse(', 'zoltar.splitMigrationRep(')]),
	evidence('forker-zoltar', 'statoblast-pool-forker', 'zoltar-core', 'calls', [location('statoblast-pool-forker', 'zoltar.getForkThreshold(', 'zoltar.getMigrationRepBalance(')]),
	evidence('forker-pool', 'statoblast-pool-forker', 'statoblast-security-pool', 'calls', [location('statoblast-pool-forker', 'securityPool.activateForkMode(', 'securityPool.configureVault(')]),
	evidence('forker-game', 'statoblast-pool-forker', 'statoblast-escalation-game', 'calls', [location('statoblast-pool-forker', 'escalationGame.getForkCarrySnapshot(', 'escalationGame.getOutcomeBalances(')]),
	evidence('vault-base-zoltar', 'statoblast-vault-migration-base', 'zoltar-core', 'calls', [location('statoblast-vault-migration-base', 'zoltar.getRepToken(', 'zoltar.deployChild(')]),
	evidence('vault-base-factory', 'statoblast-vault-migration-base', 'statoblast-security-pool-factory', 'calls', [location('statoblast-vault-migration-base', 'parent.securityPoolFactory().deployChildSecurityPool(')]),
	evidence('vault-base-pool', 'statoblast-vault-migration-base', 'statoblast-security-pool', 'calls', [location('statoblast-vault-migration-base', 'child.configureVault(', 'parent.configureVault(')]),
	evidence('escalation-forker-child-interface', 'statoblast-escalation-game-forker', 'statoblast-child-game-initializer', 'calls', [location('statoblast-escalation-game-forker', 'ISecurityPoolForkerChildEscalationGameInitializer(address(this)).initializeChildForkedEscalationGameIfNeeded(')]),
	evidence('escalation-forker-game', 'statoblast-escalation-game-forker', 'statoblast-escalation-game', 'calls', [location('statoblast-escalation-game-forker', 'escalationGame.claimDepositForWinningWithoutTransfer(', 'parentEscalationGame.exportForkedEscrowByOutcomeWithoutTransfer(')]),
	evidence('escalation-forker-pool', 'statoblast-escalation-game-forker', 'statoblast-security-pool', 'calls', [location('statoblast-escalation-game-forker', 'parent.configureVault(', 'child.systemState(')]),
	evidence('escalation-forker-zoltar', 'statoblast-escalation-game-forker', 'zoltar-core', 'calls', [location('statoblast-vault-migration-base', 'zoltar.getRepToken(', 'zoltar.deployChild(')]),
	evidence('openoracle-permit2', 'openoracle-core', 'openoracle-signature-transfer', 'calls', [location('openoracle-core', 'ISignatureTransfer(PERMIT2).permitWitnessTransferFrom(')]),
	evidence('test-share-authorization', 'test-share-token-authorization-pool', 'statoblast-share-token', 'calls', [location('test-share-token-authorization-pool', 'shareToken.authorize(')]),

	// Library, module, interface, and type use.
	evidence('zoltar-question-scalar', 'zoltar-question-data', 'zoltar-scalar-outcomes', 'uses', [location('zoltar-question-data', 'ScalarOutcomes.getScalarOutcomeName(')]),
	evidence('zoltar-core-constants', 'zoltar-core', 'zoltar-constants', 'uses', [location('zoltar-core', 'Constants.MINIMUM_FORK_BURN_DIVISOR')]),
	evidence('zoltar-core-safe-erc20', 'zoltar-core', 'zoltar-safe-erc20-ops', 'uses', [location('zoltar-core', 'using SafeERC20Ops for IERC20')]),
	evidence('zoltar-core-ierc20', 'zoltar-core', 'zoltar-ierc20', 'uses', [location('zoltar-core', 'IERC20(address(reputationToken)).safeTransfer(')]),
	evidence('zoltar-safe-ops-interface', 'zoltar-safe-erc20-ops', 'zoltar-ierc20', 'uses', [location('zoltar-safe-erc20-ops', 'abi.encodeCall(IERC20.transfer,')]),
	evidence('share-factory-zoltar', 'statoblast-share-token-factory', 'zoltar-core', 'uses', [location('statoblast-share-token-factory', 'Zoltar immutable zoltar')]),
	evidence('price-factory-weth', 'statoblast-price-coordinator-factory', 'statoblast-iweth9', 'uses', [location('statoblast-price-coordinator-factory', 'IWeth9 public immutable weth')]),
	evidence('price-coordinator-pool-utils', 'statoblast-price-coordinator', 'statoblast-security-pool-utils', 'uses', [location('statoblast-price-coordinator', 'SecurityPoolUtils.MIN_REP_DEPOSIT')]),
	evidence('price-coordinator-math', 'statoblast-price-coordinator', 'openoracle-math', 'uses', [location('statoblast-price-coordinator', 'Math.mulDiv(')]),
	evidence('price-coordinator-stored-game', 'statoblast-price-coordinator', 'statoblast-stored-open-oracle-game', 'uses', [location('statoblast-price-coordinator', 'IStoredOpenOracleGame(address(openOracle)).storedGame(')]),
	evidence('share-token-token-id', 'statoblast-share-token', 'statoblast-token-id', 'uses', [location('statoblast-share-token', 'TokenId.getTokenId(')]),
	evidence('share-token-binary-outcomes', 'statoblast-share-token', 'statoblast-binary-outcomes', 'uses', [location('statoblast-share-token', 'BinaryOutcomes.BinaryOutcome.Invalid')]),
	evidence('pool-utils-runtime', 'statoblast-security-pool', 'statoblast-security-pool-utils', 'uses', [location('statoblast-security-pool', 'SecurityPoolUtils.calculateRetentionRate(')]),
	evidence('pool-binary-outcomes', 'statoblast-security-pool', 'statoblast-binary-outcomes', 'uses', [location('statoblast-security-pool', 'BinaryOutcomes.BinaryOutcome.None')]),
	evidence('deposit-delegate-mmr', 'statoblast-escalation-deposit-delegate', 'statoblast-merkle-mountain-range', 'uses', [location('statoblast-escalation-deposit-delegate', 'MerkleMountainRange.hashLeaf(')]),
	evidence('proof-verifier-mmr', 'statoblast-escalation-proof-verifier', 'statoblast-merkle-mountain-range', 'uses', [location('statoblast-escalation-proof-verifier', 'MerkleMountainRange.bagPeaks(')]),
	evidence('escalation-types-storage', 'statoblast-escalation-storage', 'statoblast-escalation-types', 'uses', [location('statoblast-escalation-storage', 'OutcomeState[3] internal outcomeState')]),
	evidence('escalation-types-carry', 'statoblast-escalation-carry', 'statoblast-escalation-types', 'uses', [location('statoblast-escalation-carry', 'CarryLeafView[] memory carryLeaves')]),
	evidence('escalation-binary-calculations', 'statoblast-escalation-calculations', 'statoblast-binary-outcomes', 'uses', [location('statoblast-escalation-calculations', 'BinaryOutcomes.BinaryOutcome.None')]),
	evidence('auction-math', 'statoblast-truth-auction', 'openoracle-math', 'uses', [location('statoblast-truth-auction', 'Math.mulDiv(')]),
	evidence('vault-base-types', 'statoblast-vault-migration-base', 'statoblast-forker-types', 'uses', [location('statoblast-vault-migration-base', 'SecurityPoolForkerForkData storage childData')]),
	evidence('forker-storage-types', 'statoblast-forker-storage', 'statoblast-forker-types', 'uses', [location('statoblast-forker-storage', 'mapping(ISecurityPool => SecurityPoolForkerForkData) internal forkDataByPool')]),
	evidence('forker-utils', 'statoblast-pool-forker', 'statoblast-security-pool-utils', 'uses', [location('statoblast-pool-forker', 'SecurityPoolUtils.MIGRATION_TIME')]),
	evidence('forker-binary', 'statoblast-pool-forker', 'statoblast-binary-outcomes', 'uses', [location('statoblast-pool-forker', 'BinaryOutcomes.BinaryOutcome.None')]),
	evidence('openoracle-errors-edge', 'openoracle-core', 'openoracle-errors', 'uses', [location('openoracle-core', 'Errors.InvalidMode(')]),
	evidence('openoracle-erc20-edge', 'openoracle-core', 'openoracle-ierc20', 'uses', [location('openoracle-core', 'IERC20(token).safeTransferFrom(')]),
	evidence('openoracle-safe-erc20-edge', 'openoracle-core', 'openoracle-safe-erc20', 'uses', [location('openoracle-core', 'using SafeERC20 for IERC20')]),
	evidence('safe-erc20-interface', 'openoracle-safe-erc20', 'openoracle-ierc20', 'uses', [location('openoracle-safe-erc20', 'function safeTransfer(IERC20 token,')]),
	evidence('safe-erc20-1363', 'openoracle-safe-erc20', 'openoracle-ierc1363', 'uses', [location('openoracle-safe-erc20', 'function transferAndCallRelaxed(IERC1363 token,')]),
	evidence('math-panic', 'openoracle-math', 'openoracle-panic', 'uses', [location('openoracle-math', 'Panic.panic(')]),
	evidence('math-safe-cast', 'openoracle-math', 'openoracle-safe-cast', 'uses', [location('openoracle-math', 'SafeCast.toUint(')]),

	// Structural compatibility is intentional without declared inheritance.
	evidence('worker-config-interface', 'statoblast-security-pool-worker', 'statoblast-deployment-worker-config', 'compatible', [location('statoblast-security-pool-worker', 'ISecurityPoolFactory public immutable factory', 'SecurityPoolEventEmitter public immutable eventEmitter')]),
	evidence('weth-interface', 'infra-weth9', 'statoblast-iweth9', 'compatible', [location('infra-weth9', 'function deposit() public payable', 'function withdraw(uint wad) external', 'function transferFrom(address src, address dst, uint wad) public returns (bool)')]),

	// Test-only behavior is tied to code inside the exact test declaration.
	evidence('test-complete-set-reentrancy', 'test-complete-set-reentrant-receiver', 'statoblast-security-pool', 'tests', [location('test-complete-set-reentrant-receiver', 'securityPool.createCompleteSet{ value: reentrantValue }(')]),
	evidence('test-escalation-factory-pool', 'test-escalation-factory-coverage-pool', 'statoblast-escalation-game-factory', 'tests', [location('test-escalation-factory-coverage-pool', 'factory.deployEscalationGame(', 'factory.deployEscalationGameFromFork(')]),
	evidence('test-non-receiver', 'test-erc1155-non-receiver', 'statoblast-erc1155', 'tests', [location('test-erc1155-non-receiver', 'contract ERC1155NonReceiver {}')]),
	evidence('test-threshold-zoltar', 'test-fork-boundary-zoltar', 'zoltar-core', 'tests', [location('test-fork-boundary-zoltar', 'function getForkThreshold(uint248)')]),
	evidence('test-threshold-pool', 'test-fork-boundary-pool', 'statoblast-escalation-calculations', 'tests', [location('test-fork-boundary-pool', 'Zoltar public immutable zoltar')]),
	evidence('test-escalation-forker-edge', 'test-escalation-forker-harness', 'statoblast-escalation-game-forker', 'tests', [location('test-escalation-forker-harness', 'parentEscalationGame.exportForkedEscrowByOutcomeWithoutTransfer(')]),
	evidence('test-proof-pool-edge', 'test-escalation-proof-pool', 'statoblast-escalation-proof-verifier', 'tests', [location('test-escalation-proof-pool', 'function initializeForkCarrySnapshotWithResolutionBalances(')]),
	evidence('test-incompatible-verifier-edge', 'test-incompatible-proof-verifier', 'statoblast-escalation-state', 'tests', [location('test-incompatible-proof-verifier', 'function computeEmptyNullifierRoot(')]),
	evidence('test-openoracle-receiver-edge', 'test-openoracle-rejecting-receiver', 'openoracle-core', 'tests', [location('test-openoracle-rejecting-receiver', 'receive() external payable', 'require(!rejectETH,')]),
	evidence('test-own-fork-claim-edge', 'test-own-fork-claim-harness', 'statoblast-escalation-game-forker', 'tests', [location('test-own-fork-claim-harness', 'function previewOwnForkEscalationOwnershipToCredit(')]),
	evidence('test-safe-ops-edge', 'test-safe-erc20-ops-harness', 'zoltar-safe-erc20-ops', 'tests', [location('test-safe-erc20-ops-harness', 'token.safeTransferFrom(')]),
	evidence('test-ancestor-edge', 'test-security-pool-ancestor', 'statoblast-pool-forker', 'tests', [location('test-security-pool-ancestor', 'address public immutable parent')]),
	evidence('test-constructor-zoltar-edge', 'test-constructor-failure-zoltar', 'statoblast-security-pool', 'tests', [location('test-constructor-failure-zoltar', 'return ReputationToken(address(0x1234))')]),
	evidence('test-malicious-emitter-edge', 'test-forker-malicious-emitter', 'statoblast-event-emitter', 'tests', [location('test-forker-malicious-emitter', 'targetPool.transferEth(receiver, targetPool.completeSetCollateralAmount())')]),
	evidence('test-fake-pool-edge', 'test-forker-fake-pool', 'statoblast-security-pool-interface', 'tests', [location('test-forker-fake-pool', 'return configuredEventEmitter')]),
	evidence('test-attack-factory-edge', 'test-forker-attack-factory', 'statoblast-security-pool-factory-interface', 'tests', [location('test-forker-attack-factory', 'return (childPool, childTruthAuction)')]),
	evidence('test-attack-parent-edge', 'test-forker-attack-parent', 'statoblast-pool-forker', 'tests', [location('test-forker-attack-parent', 'return configuredSecurityPoolFactory')]),
	evidence('test-escrow-factory-edge', 'test-forker-escrow-factory', 'statoblast-security-pool-factory-interface', 'tests', [location('test-forker-escrow-factory', 'return (childPool, childTruthAuction)')]),
	evidence('test-escrow-game-edge', 'test-forker-escrow-game', 'statoblast-escalation-game', 'tests', [location('test-forker-escrow-game', 'return (configuredDepositor, configuredClaimAmount, configuredClaimAmount)')]),
	evidence('test-escrow-parent-edge', 'test-forker-escrow-parent', 'statoblast-pool-forker', 'tests', [location('test-forker-escrow-parent', 'configuredEscalationGame.drainToForker(')]),
	evidence('test-alternating-game-edge', 'test-forker-alternating-game', 'statoblast-escalation-game', 'tests', [location('test-forker-alternating-game', 'return configuredForkResumedAt')]),
	evidence('test-escrow-child-edge', 'test-forker-escrow-child', 'statoblast-security-pool', 'tests', [location('test-forker-escrow-child', 'if (operationalMode) useSecondOperationalEscalationGame = true')]),
	evidence('test-auction-pool-edge', 'test-auction-settlement-pool', 'statoblast-security-pool', 'tests', [location('test-auction-settlement-pool', 'feeEligibleSecurityBondAllowance += amount')]),

	// Asset paths name the same sender and recipient wording rendered in the
	// relationship register and link each direction to concrete transfer code.
	assetEvidence(
		'pool-reputation-token',
		'statoblast-security-pool',
		'zoltar-reputation-token',
		flow('REP vault or reporter', 'pool', location('statoblast-security-pool', 'safeTransferFrom(msg.sender, address(this), repAmount)')),
		flow('pool', 'escalation game or forker', location('statoblast-security-pool', 'safeTransfer(address(escalationGame), depositedAmount)', 'safeTransfer(msg.sender, repTransferred)')),
		flow('pool', 'redemption recipient', location('statoblast-security-pool', 'safeTransfer(vault, repAmount)')),
	),
	assetEvidence(
		'pool-escalation-game',
		'statoblast-security-pool',
		'statoblast-escalation-game',
		flow('pool', 'game escrow', location('statoblast-security-pool', 'safeTransfer(address(escalationGame), depositedAmount)')),
		flow('game', 'pool or claimant', location('statoblast-escalation-settlement', '_safeTransferRep(address(securityPool), amount)', '_safeTransferRep(depositor, amountToWithdraw)')),
	),
	assetEvidence(
		'price-coordinator-openoracle',
		'statoblast-price-coordinator',
		'openoracle-core',
		flow('coordinator', 'OpenOracle', location('statoblast-price-coordinator', 'openOracle.report{ value: ethCost }(')),
		flow('OpenOracle', 'sponsor', location('statoblast-price-coordinator', 'openOracle.withdrawTo(address(weth), type(uint256).max, sponsor)')),
	),
	assetEvidence(
		'price-coordinator-weth',
		'statoblast-price-coordinator',
		'statoblast-iweth9',
		flow('sponsor', 'coordinator', location('statoblast-price-coordinator', 'weth.transferFrom(sponsor, address(this), initialWethReport)')),
		flow('coordinator', 'OpenOracle', location('statoblast-price-coordinator', 'weth.approve(address(openOracle), initialWethReport)')),
		flow('OpenOracle', 'sponsor', location('statoblast-price-coordinator', 'openOracle.withdrawTo(address(weth), type(uint256).max, sponsor)')),
	),
	assetEvidence(
		'price-coordinator-rep',
		'statoblast-price-coordinator',
		'zoltar-reputation-token',
		flow('sponsor', 'coordinator', location('statoblast-price-coordinator', 'reputationToken.transferFrom(sponsor, address(this), amount2)')),
		flow('coordinator', 'OpenOracle', location('statoblast-price-coordinator', 'reputationToken.approve(address(openOracle), amount2)')),
		flow('OpenOracle', 'sponsor', location('statoblast-price-coordinator', 'openOracle.withdrawTo(address(reputationToken), type(uint256).max, sponsor)')),
	),
	assetEvidence(
		'state-reputation-token',
		'statoblast-escalation-state',
		'zoltar-reputation-token',
		flow('game escrow', 'claimant, pool, or fork export recipient', location('statoblast-escalation-state', 'IERC20(address(repToken)).safeTransfer(receiver, amount)'), location('statoblast-escalation-settlement', '_safeTransferRep(address(securityPool), amount)', '_safeTransferRep(depositor, amountToWithdraw)')),
	),
	assetEvidence('forker-proxy-assets', 'statoblast-pool-forker', 'statoblast-migration-proxy', flow('forker', 'migration proxy', location('statoblast-pool-forker', 'safeTransfer(address(migrationProxy), repToLock)', 'migrationProxy.lockRep(repToLock)'))),
	assetEvidence('forker-reputation-token', 'statoblast-pool-forker', 'zoltar-reputation-token', flow('forker', 'stable migration proxy', location('statoblast-pool-forker', 'safeTransfer(address(migrationProxy), repToFork)'))),
	assetEvidence(
		'proxy-reputation-token',
		'statoblast-migration-proxy',
		'zoltar-reputation-token',
		flow('proxy', 'Zoltar', location('statoblast-migration-proxy', 'safeApprove(address(_zoltar), type(uint256).max)')),
		flow('proxy', 'configured receiver', location('statoblast-migration-proxy', 'safeTransfer(receiver, amount)')),
	),
	assetEvidence(
		'forker-auction',
		'statoblast-pool-forker',
		'statoblast-truth-auction',
		flow('bidder', 'auction', location('statoblast-truth-auction', '_appendBid(tick, msg.sender, msg.value)')),
		flow('auction', 'forker', location('statoblast-truth-auction', 'payable(owner).call{ value: ethToSend }(')),
		flow('forker', 'child pool', location('statoblast-pool-forker', 'payable(address(securityPool)).call{ value: ethReceived }(')),
		flow('auction', 'bidder', location('statoblast-truth-auction', 'payable(bidder).call{ value: amount, gas: REFUND_PUSH_GAS_LIMIT }(')),
	),
	assetEvidence(
		'vault-base-proxy',
		'statoblast-vault-migration-base',
		'statoblast-migration-proxy',
		flow('migration proxy', 'child pools and escalation games', location('statoblast-vault-migration-base', 'migrationProxy.sweepChildRep(address(childEscalationGame), child.repToken(), childRepAmount)', 'migrationProxy.sweepChildRep(address(child), child.repToken(), pendingChildRep)')),
	),
]
