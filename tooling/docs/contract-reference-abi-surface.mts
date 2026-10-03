import assert from 'node:assert/strict'

export const entrypointSignaturesBySource: Record<string, Record<string, string[]>> = {
	'solidity/contracts/ERC20.sol': {
		approve: ['public(address,uint256)'],
		transfer: ['public(address,uint256)'],
		transferFrom: ['public(address,address,uint256)'],
	},
	'solidity/contracts/ZoltarQuestionData.sol': {
		createQuestion: ['external(QuestionData,string[])'],
	},
	'solidity/contracts/Zoltar.sol': {
		addRepToMigrationBalance: ['public(uint248,uint256)'],
		burnRep: ['external(uint248,uint256)'],
		deployChild: ['public(uint248,uint256)'],
		forkUniverse: ['public(uint248,uint256)'],
		splitMigrationRep: ['public(uint248,uint256,uint256[])'],
		prepareAndSplitMigrationRep: ['external(uint248,uint256,uint256[],uint256)'],
	},
	'solidity/contracts/ReputationToken.sol': {
		burn: ['external(address,uint256)'],
		initialize: ['external(uint248,uint256,uint256)'],
		mint: ['external(address,uint256)'],
	},
	'solidity/contracts/vendor/authorization/ERC20Authorization.sol': {
		cancelAuthorization: ['external(address,bytes32,uint8,bytes32,bytes32)'],
		permit: ['external(address,address,uint256,uint256,uint8,bytes32,bytes32)'],
		receiveWithAuthorization: ['external(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'],
		transferWithAuthorization: ['external(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'],
	},
	'solidity/contracts/statoblast/factories/SecurityPoolFactory.sol': {
		deployChildSecurityPool: ['external(ISecurityPool,IShareToken,uint248,uint256,uint256,uint256,uint256)'],
		deployOriginSecurityPool: ['external(uint248,uint256,uint256,uint256)'],
	},
	'solidity/contracts/statoblast/EscalationGame.sol': {
		applyTruthAuctionHaircut: ['external(uint256)'],
		depositRepOnOutcome: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		recordDepositFromSecurityPool: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256)'],
		resumeFromFork: ['external()'],
		start: ['external(uint256,uint256)'],
		startFromFork: ['external(uint256,uint256,uint256,BinaryOutcomes.BinaryOutcome,bool,uint256)'],
	},
	'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol': {
		initializeForkClaimCheckpoint: ['external(address)'],
	},
	'solidity/contracts/statoblast/EscalationGameCarry.sol': {
		initializeForkCarrySnapshotWithResolutionBalances: ['external(address,bytes32,bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS][3],uint256[3],uint256[3],uint256[3],bytes32[3])'],
	},
	'solidity/contracts/statoblast/EscalationGameEscrow.sol': {
		exportForkedEscrowByOutcome: ['external(address,address)'],
		exportForkedEscrowByOutcomeWithoutTransfer: ['external(address)'],
		exportVaultUnresolvedTotals: ['external(address,address)'],
		exportVaultUnresolvedTotalsWithoutTransfer: ['external(address)'],
		recordForkedEscrowForOutcome: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256)'],
	},
	'solidity/contracts/statoblast/EscalationGameSettlement.sol': {
		claimDepositForWinning: ['public(uint256,BinaryOutcomes.BinaryOutcome)'],
		claimDepositForWinningWithoutTransfer: ['public(uint256,BinaryOutcomes.BinaryOutcome)'],
		drainAllRep: ['external(address)'],
		exportUnresolvedDeposit: ['public(uint256,BinaryOutcomes.BinaryOutcome)'],
		sweepResidualRepToSecurityPool: ['external()'],
		withdrawDeposit: ['public(CarriedDepositProof,BinaryOutcomes.BinaryOutcome)', 'public(uint256,BinaryOutcomes.BinaryOutcome)'],
	},
	'solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol': {
		stageVaultOperations: ['external(address,bool,uint256,uint256,uint256,uint256,uint256)'],
		executeStagedOperation: ['public(uint256)'],
		expireStagedOperation: ['external(uint256)'],
		openOracleCallback: ['external(uint256,uint256,uint256,uint256,address,address)'],
		recoverSettledPendingReport: ['public()'],
		requestPrice: ['public(uint256,uint256,uint256)'],
		requestPriceIfNeededAndStageLiquidation: ['external(address,address,uint256,bytes32,uint256,uint256,uint256,uint256)'],
		requestPriceIfNeededAndStageOperation: ['public(OperationType,address,uint256,uint256,uint256,uint256,uint256)'],
		setLiquidationApprovalRegistry: ['external(LiquidationApprovalRegistry)'],
		setRepEthPrice: ['public(uint256)'],
		setSecurityPool: ['public(ISecurityPool)'],
	},
	'solidity/contracts/statoblast/LiquidationApprovalRegistry.sol': {
		consume: ['external(uint256,uint256)'],
		initialize: ['external(address)'],
		invalidateLiquidationApprovalNonce: ['external(uint256)'],
		permitLiquidationApproval: ['external(LiquidationApprovalParams,bytes)'],
		release: ['external(uint256)'],
		reserve: ['external(uint256,bytes32,address,address,address,uint256,uint256,uint256)'],
		revokeLiquidationApproval: ['external(bytes32)'],
		setLiquidationApproval: ['external(LiquidationApprovalParams)'],
	},
	'solidity/contracts/statoblast/SecurityPool.sol': {
		activateForkMode: ['external()'],
		assignFinalizedAuctionFees: ['external(address,uint256,uint256)'],
		authorizeChildPool: ['external(ISecurityPool)'],
		burnEscalationWinnerHaircut: ['external(uint256)'],
		configureFinalizedAuctionVault: ['external(address,uint256,uint256,uint256,uint256,uint256)'],
		configureVault: ['external(address,uint256,uint256,uint256,uint256,uint256)'],
		setUnderwritingLimit: ['external(uint256)'],
		activateRecoveredCommitment: ['external(address,uint256)'],
		createCompleteSet: ['external()'],
		depositRepToVault: ['external(uint256,uint256)'],
		depositToEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		depositWalletRepToEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		initializeForkCarrySnapshotWithResolutionBalances: ['external(address,bytes32,bytes32[64][3],uint256[3],uint256[3],uint256[3],bytes32[3])'],
		initializeForkedEscalationGame: ['external(uint256,uint256,uint256,BinaryOutcomes.BinaryOutcome)'],
		performLiquidation: ['external(LiquidationRequest)'],
		withdrawRepFromVault: ['external(address,uint256)'],
		receive: ['external payable()'],
		redeemCompleteSet: ['external(uint256)'],
		redeemFees: ['external(address)'],
		redeemRepFromVault: ['external(address)'],
		redeemShares: ['external()'],
		resumeForkedEscalationGame: ['external()'],
		setAwaitingForkContinuation: ['external(bool)'],
		setTotalRepBackingUnits: ['external(uint256)'],
		setPoolFinancials: ['external(uint256,uint256,uint256,uint256)'],
		setStartingParams: ['external(uint256,uint256)'],
		setSystemState: ['external(SystemState)'],
		setShareTokenSupplyAttoShares: ['external(uint256)'],
		transferEth: ['external(address payable,uint256)'],
		updateSettlementCollateral: ['public()'],
		updateRetentionRate: ['public()'],
		updateVaultFees: ['public(address)'],
		withdrawForkedEscalationDeposits: ['external(QuestionOutcome,CarriedDepositProof[])'],
		withdrawFromEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256[])'],
	},
	'solidity/contracts/statoblast/SecurityPoolForker.sol': {
		claimAuctionProceeds: ['external(ISecurityPool,address,IUniformPriceDualCapBatchAuction.TickIndex[])'],
		takeOverUnassignedCommitment: ['external(ISecurityPool,uint256)'],
		claimForkedEscalationDeposits: ['external(ISecurityPool,address,BinaryOutcomes.BinaryOutcome,uint256[])'],
		createChildUniverse: ['external(ISecurityPool,uint256)'],
		finalizeTruthAuction: ['external(ISecurityPool)'],
		forkZoltarWithOwnEscalationGame: ['external(ISecurityPool)'],
		initiateSecurityPoolFork: ['external(ISecurityPool)'],
		initializeChildForkedEscalationGameIfNeeded: ['external(ISecurityPool,ISecurityPool,EscalationGame)'],
		migrateRepToZoltar: ['external(ISecurityPool,uint256[])'],
		migrateVault: ['public(ISecurityPool,uint256)'],
		migrateVaultWithUnresolvedEscalation: ['external(ISecurityPool,address,uint256)'],
		receive: ['external payable()'],
		settleAuctionBids: ['external(ISecurityPool,address,IUniformPriceDualCapBatchAuction.TickIndex[],IUniformPriceDualCapBatchAuction.TickIndex[])'],
		startTruthAuction: ['external(ISecurityPool)'],
	},
	'solidity/contracts/statoblast/UniformPriceDualCapBatchAuction.sol': {
		finalize: ['external()'],
		refundLosingBids: ['external(IUniformPriceDualCapBatchAuction.TickIndex[])'],
		refundLosingBidsFor: ['external(address,IUniformPriceDualCapBatchAuction.TickIndex[])'],
		startAuction: ['public(uint256,uint256)'],
		submitBid: ['external(int256)'],
		withdrawBids: ['external(address,IUniformPriceDualCapBatchAuction.TickIndex[],uint256,uint256,uint256)'],
		withdrawPendingEthRefund: ['external()'],
	},
	'solidity/contracts/statoblast/VaultOperations.sol': {
		execute: ['public(uint256)'],
		executeSingle: ['external(uint256,StagedOperation)'],
		release: ['external(uint256)'],
		submitVaultOperations: ['external(VaultOperationsInput,uint256,uint256,uint256)'],
	},
	'solidity/contracts/statoblast/tokens/ShareToken.sol': {
		authorize: ['external(ISecurityPool)'],
		burnCompleteSets: ['external(uint248,address,uint256)'],
		burnTokenIdAndGetRemainingSupply: ['external(uint256,address)'],
		migrate: ['external(uint256,uint256[])'],
		mintCompleteSets: ['external(uint248,address,uint256)'],
	},
	'solidity/contracts/statoblast/tokens/ERC1155.sol': {
		safeBatchTransferFrom: ['external(address,address,uint256[],uint256[])', 'external(address,address,uint256[],uint256[],bytes)'],
		safeTransferFrom: ['external(address,address,uint256,uint256)', 'external(address,address,uint256,uint256,bytes)'],
		setApprovalForAll: ['external(address,bool)'],
	},
}

// Selectors a documented contract reaches only through its `fallback()`. Keyed by the routing contract source, then by the
// delegate source that declares the implementation. The generator checks each signature against the delegate source and
// requires the routing contract's fallback to reference exactly these `Delegate.name.selector` values.
export const fallbackRoutedEntrypointSignatures: Record<string, Record<string, Record<string, string[]>>> = {
	'solidity/contracts/statoblast/SecurityPool.sol': {
		'solidity/contracts/statoblast/SecurityPoolOperationsDelegate.sol': {
			depositRepToVaultFromExecutor: ['external(address,uint256)'],
			depositRepToVaultWithAuthorization: ['external(address,uint256,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'],
			depositRepToVaultWithPermit: ['external(uint256,uint256,uint256,uint8,bytes32,bytes32)'],
			setVaultUnderwritingLimit: ['external(address,uint256)'],
		},
	},
	'solidity/contracts/statoblast/EscalationGame.sol': {
		'solidity/contracts/statoblast/EscalationGameDepositDelegate.sol': {
			depositRepOnOutcomeWithAuthorization: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'],
			depositRepOnOutcomeWithPermit: ['external(BinaryOutcomes.BinaryOutcome,uint256,uint256,uint8,bytes32,bytes32)'],
		},
	},
}

// Interface declarations that share a fingerprinted source file with the documented contract. They are not entrypoints of that contract.
export const interfaceEntrypointExclusionsBySource: Record<string, string[]> = {
	'solidity/contracts/statoblast/VaultOperations.sol': ['stageVaultOperations'],
}

export const stateChangingAbiFingerprintBySource: Record<string, string> = {
	'solidity/contracts/Context.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/ERC20.sol': '6c4161bf27a2ed1bc2de94b58253a8ec4201e28d125571cb2124238753387a22',
	'solidity/contracts/ReputationToken.sol': '30c2987453109942297ab8ee8256c53fc68cd5c22f9fd16e168cd6bbb12b8608',
	'solidity/contracts/Zoltar.sol': '7820943e20dcb5ea796e2c00af55219042cb772133f0844c8d79dcd2ae30c938',
	'solidity/contracts/ZoltarQuestionData.sol': '904b4369195f070fa3b04bbcbc1acba529810ffa2da4667569cd9168ac568d65',
	'solidity/contracts/statoblast/EscalationGame.sol': '22346007107d60d8dac5545122037fa8bc457ac604c733c03edd992276604e85',
	'solidity/contracts/statoblast/EscalationGameCalculations.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/EscalationGameCarry.sol': 'bdd7cfe47523c5e0c8985eec993214de44caf88fc4f2e6f1586d2d03c0a02ef0',
	'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol': '08f609ca28f10ebc4e1f3eeb6d109b3713e9deddd436d4f508d31d39f4396dc1',
	'solidity/contracts/statoblast/EscalationGameEscrow.sol': 'c75cd0c9ea134a3bfa03227d0500485049818553447b4b258ff220cb0d201dde',
	'solidity/contracts/statoblast/EscalationGameSettlement.sol': '73f9aad63165cacbff5bd02fd57a6b5a3f73737545018ecdf152c46f905c8c32',
	'solidity/contracts/statoblast/EscalationGameState.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/EscalationGameStorage.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol': '77ea3198cfa18acf68fcfd41ced696fd4fd87b656b26c5cb15f33f1b2075c4f0',
	'solidity/contracts/statoblast/LiquidationApprovalRegistry.sol': '986a20fc0e4cfe0898be8fc91c6b911b93ef0ae1086d4cb1142a93c66f315684',
	'solidity/contracts/statoblast/SecurityPool.sol': '6ad9c7ac714db016301f6a1aeaf985829173fc6749be0835dad277b892b9418a',
	'solidity/contracts/statoblast/SecurityPoolForker.sol': 'b885410984916de3e66b38b14532f58e495190f140342045780fba91c0cab6ab',
	'solidity/contracts/statoblast/SecurityPoolForkerBase.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/SecurityPoolForkerStorage.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/UniformPriceDualCapBatchAuction.sol': '7181208a40b17a27a92de234ac9bb59aa1a585e71742cbb1bef7878ae7ffe0ed',
	'solidity/contracts/statoblast/VaultOperations.sol': '1777a52a367b0ffa5fff11581677ba0d768958dbd78255d8973b0fa8c984023a',
	'solidity/contracts/statoblast/factories/SecurityPoolFactory.sol': '618aed7f3f8bdfd50267b9d7533db3f489f45715f1cd448f5107f67631814d34',
	'solidity/contracts/statoblast/tokens/ERC1155.sol': '7bb87695bc3df8fa177c545209ed58d2e4571c19c869b5598bb0a829e764b218',
	'solidity/contracts/statoblast/tokens/ShareToken.sol': '2a3339ca5db0ccabc2bc10318ff3baf52273b90837f01683d3e5147a13fd2d0d',
	'solidity/contracts/vendor/authorization/ERC20Authorization.sol': '6bfae34f9210ed80f176774eb2b5a3624060ce4be34825ca84949ddcfb8024d2',
}

export const readDeclarationExclusionsBySource: Record<string, string[]> = {
	'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol': ['securityPool'],
	'solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol': ['storedGame', 'disputeHistory'],
	'solidity/contracts/statoblast/LiquidationApprovalRegistry.sol': ['securityPool'],
	'solidity/contracts/statoblast/SecurityPool.sol': ['eventEmitter', 'factory', 'operationsDelegate'],
	'solidity/contracts/statoblast/SecurityPoolForkerBase.sol': [],
	'solidity/contracts/statoblast/VaultOperations.sol': ['liquidationApprovalRegistry', 'minLiquidationPriceDistanceBps', 'securityPool', 'stagedOperationCounter'],
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function assertCoordinatorDataFunctionInventory(coordinatorData: string, compiledContractArtifacts: unknown): void {
	const coordinatorIndex: unknown = JSON.parse(coordinatorData)
	assert.ok(isRecord(coordinatorIndex))
	const documentedFunctions = coordinatorIndex['functions']
	assert.ok(isRecord(documentedFunctions), 'Coordinator data must provide its complete function inventory')
	assert.ok(isRecord(compiledContractArtifacts))
	const contracts = compiledContractArtifacts['contracts']
	assert.ok(isRecord(contracts))
	const coordinatorSource = contracts['contracts/statoblast/OpenOraclePriceCoordinator.sol']
	assert.ok(isRecord(coordinatorSource))
	const coordinatorArtifact = coordinatorSource['OpenOraclePriceCoordinator']
	assert.ok(isRecord(coordinatorArtifact))
	const abi = coordinatorArtifact['abi']
	assert.ok(Array.isArray(abi))
	const compiledFunctionNames = Array.from(
		new Set(
			abi.flatMap(entry => {
				if (!isRecord(entry) || entry['type'] !== 'function' || typeof entry['name'] !== 'string') return []
				return [entry['name']]
			}),
		),
	).sort()
	assert.deepEqual(Object.keys(documentedFunctions).sort(), compiledFunctionNames, 'Coordinator data function inventory must exactly match the compiled ABI')
	const documentedSignatures = coordinatorIndex['functionSignatures']
	assert.ok(isRecord(documentedSignatures), 'Coordinator data must provide its documented signatures')
	for (const [name, signature] of Object.entries(documentedSignatures)) {
		const entry: unknown = abi.find(value => isRecord(value) && value['type'] === 'function' && value['name'] === name)
		assert.ok(isRecord(entry), `Unknown documented coordinator function: ${name}`)
		const inputs: unknown = entry['inputs']
		assert.ok(Array.isArray(inputs))
		const types = inputs.map((input: unknown) => {
			assert.ok(isRecord(input) && typeof input['type'] === 'string')
			return input['type']
		})
		assert.equal(signature, `${name}(${types.join(',')})`, `Coordinator signature must match the compiled ABI: ${name}`)
	}
}
