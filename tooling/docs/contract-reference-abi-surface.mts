import assert from 'node:assert/strict'
export const entrypointSignaturesBySource: Record<string, Record<string, string[]>> = {
	'solidity/contracts/ZoltarQuestionData.sol': {
		createQuestion: ['external(QuestionData,string[])'],
	},
	'solidity/contracts/Zoltar.sol': {
		forkUniverse: ['public(uint248,uint256)'],
		burnRep: ['external(uint248,uint256)'],
		deployChild: ['public(uint248,uint256)'],
		addRepToMigrationBalance: ['public(uint248,uint256)'],
		prepareAndSplitMigrationRep: ['external(uint248,uint256,uint256[],uint256)'],
		splitMigrationRep: ['public(uint248,uint256,uint256[])'],
	},
	'solidity/contracts/ReputationToken.sol': {
		initialize: ['external(uint248,uint256,uint256)'],
		mint: ['external(address,uint256)'],
		burn: ['external(address,uint256)'],
	},
	'solidity/contracts/ERC20.sol': {
		transfer: ['public(address,uint256)'],
		approve: ['public(address,uint256)'],
		transferFrom: ['public(address,address,uint256)'],
	},
	'solidity/contracts/vendor/authorization/ERC20Authorization.sol': {
		permit: ['external(address,address,uint256,uint256,uint8,bytes32,bytes32)'],
		transferWithAuthorization: ['external(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'],
		receiveWithAuthorization: ['external(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'],
		cancelAuthorization: ['external(address,bytes32,uint8,bytes32,bytes32)'],
	},
	'solidity/contracts/statoblast/factories/SecurityPoolFactory.sol': {
		initializePortfolioPriceFeed: ['external(uint248,uint256)'],
		initializePortfolioPriceFeedForUniverse: ['external(uint248)'],
		preparePortfolioPriceFeed: ['external(ISecurityPool,uint248)'],
		deployPortfolioSecurityPool: ['external(uint248,uint256,uint256,uint256)'],
		preparePortfolioChildPriceFeed: ['external(ISecurityPool,uint256)'],
		prepareChildPoolDependencies: ['external(ISecurityPool,uint256)'],
		deployChildSecurityPool: ['external(ISecurityPool,IShareToken,uint248,uint256,uint256,uint256,uint256)'],
	},
	'solidity/contracts/statoblast/SecurityPool.sol': {
		setPortfolioCustody: ['external(address)'],
		creditEscalationSurplus: ['external(uint256)'],
		refreshPortfolioFees: ['public()'],
		burnEscalationWinnerHaircut: ['external(uint256)'],
		createCompleteSet: ['external()'],
		redeemCompleteSet: ['external(uint256)'],
		redeemShares: ['external()'],
		depositWalletRepToEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		withdrawFromEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256[])'],
		withdrawForkedEscalationDeposits: ['external(QuestionOutcome,CarriedDepositProof[])'],
		updateSettlementCollateral: ['public()'],
		updateRetentionRate: ['public()'],
		setStartingParams: ['external(uint256,uint256)'],
		activateForkMode: ['external()'],
		initializeForkedEscalationGame: ['external(uint256,uint256,int256,BinaryOutcomes.BinaryOutcome)'],
		initializeForkCarryOutcome: ['external(address,bytes32,bytes32[64],uint256,uint256,uint256,bytes32)'],
		resumeForkedEscalationGame: ['external()'],
		setAwaitingForkContinuation: ['external(bool)'],
		setSystemState: ['external(SystemState)'],
		setShareTokenSupplyAttoShares: ['external(uint256)'],
		authorizeChildPool: ['external(ISecurityPool)'],
		receive: ['external payable()'],
	},
	'solidity/contracts/statoblast/SecurityPoolForker.sol': {
		preparePortfolioQuestion: ['external(ISecurityPool,uint248)'],
		materializePortfolioQuestion: ['external(ISecurityPool,uint248)'],
		initiateSecurityPoolFork: ['external(ISecurityPool)'],
		forkZoltarWithOwnEscalationGame: ['external(ISecurityPool)'],
		createChildUniverse: ['external(ISecurityPool,uint256)'],
	},
	'solidity/contracts/statoblast/EscalationGame.sol': {
		start: ['external(uint256,uint256)'],
		startFromFork: ['external(uint256,uint256,int256,BinaryOutcomes.BinaryOutcome,bool,uint256)'],
		resumeFromFork: ['external()'],
		depositRepOnOutcome: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		recordDepositFromSecurityPool: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256)'],
	},
	'solidity/contracts/statoblast/EscalationGameSettlement.sol': {
		drainAllRep: ['external(address)'],
		withdrawDeposit: ['public(CarriedDepositProof,BinaryOutcomes.BinaryOutcome)', 'public(uint256,BinaryOutcomes.BinaryOutcome)'],
		claimDepositForWinning: ['public(uint256,BinaryOutcomes.BinaryOutcome)'],
		exportUnresolvedDeposit: ['public(uint256,BinaryOutcomes.BinaryOutcome)'],
		settleOrdinaryGame: ['external()'],
		sweepResidualRepToSecurityPool: ['external()'],
	},
	'solidity/contracts/statoblast/EscalationGameCarry.sol': {
		initializeForkCarryOutcome: ['external(address,bytes32,bytes32[64],uint256,uint256,uint256,bytes32)'],
	},
	'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol': {
		processClaimCheckpoint: ['external(uint8,uint256,uint256,uint256,uint256,bytes32,EscalationClaimTransform[])'],
		initializeForkClaimCheckpoint: ['external(address)'],
	},
	'solidity/contracts/statoblast/EscalationGameEscrow.sol': {
		exportVaultUnresolvedTotalsWithoutTransfer: ['external(address)'],
		recordForkedEscrowForOutcome: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256)'],
		exportForkedEscrowByOutcome: ['external(address,address)'],
		exportForkedEscrowByOutcomeWithoutTransfer: ['external(address)'],
	},
	'solidity/contracts/statoblast/OpenOraclePriceSource.sol': {
		requestPrice: ['public(uint256,uint256,uint256)'],
		recoverSettledPendingReport: ['public()'],
		setSharedPriceFeed: ['external(SharedPoolPriceFeed)'],
		syncExposure: ['external()'],
		setSecurityPool: ['public(ISecurityPool)'],
	},
	'solidity/contracts/statoblast/tokens/ERC1155.sol': {
		setApprovalForAll: ['external(address,bool)'],
		safeTransferFrom: ['external(address,address,uint256,uint256)', 'external(address,address,uint256,uint256,bytes)'],
		safeBatchTransferFrom: ['external(address,address,uint256[],uint256[])', 'external(address,address,uint256[],uint256[],bytes)'],
	},
	'solidity/contracts/statoblast/tokens/ShareToken.sol': {
		transferPortfolioRecoveryRights: ['external(uint248,address,uint256[3])'],
		consumePortfolioRecoveryCompleteSets: ['external(uint248,address,uint256)'],
		migrate: ['external(uint256,uint256[])'],
		authorize: ['external(ISecurityPool)'],
		mintCompleteSets: ['external(uint248,address,uint256)'],
		burnCompleteSets: ['external(uint248,address,uint256)'],
		burnTokenIdAndGetRemainingSupply: ['external(uint256,address)'],
	},
}
export const fallbackRoutedEntrypointSignatures: Record<string, Record<string, Record<string, string[]>>> = {
	'solidity/contracts/statoblast/EscalationGame.sol': {
		'solidity/contracts/statoblast/EscalationGameDepositDelegate.sol': {
			depositRepOnOutcomeWithAuthorization: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'],
			depositRepOnOutcomeWithPermit: ['external(BinaryOutcomes.BinaryOutcome,uint256,uint256,uint8,bytes32,bytes32)'],
		},
	},
}
export const interfaceEntrypointExclusionsBySource: Record<string, string[]> = {}
export const stateChangingAbiFingerprintBySource: Record<string, string> = {
	'solidity/contracts/statoblast/OpenOraclePriceSource.sol': '825ac979b8b2a2b3622c65a0dfc79be3252b1315e829fbcf60fdf99fe0da230b',
	'solidity/contracts/Context.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/ERC20.sol': '6c4161bf27a2ed1bc2de94b58253a8ec4201e28d125571cb2124238753387a22',
	'solidity/contracts/ReputationToken.sol': '30c2987453109942297ab8ee8256c53fc68cd5c22f9fd16e168cd6bbb12b8608',
	'solidity/contracts/Zoltar.sol': '7820943e20dcb5ea796e2c00af55219042cb772133f0844c8d79dcd2ae30c938',
	'solidity/contracts/ZoltarQuestionData.sol': '904b4369195f070fa3b04bbcbc1acba529810ffa2da4667569cd9168ac568d65',
	'solidity/contracts/statoblast/EscalationGame.sol': '24e80a30f54f19c2863e1ae256e092939ec09178361e35319fa79b2206cad019',
	'solidity/contracts/statoblast/EscalationGameCalculations.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/EscalationGameCarry.sol': '7a09d1ce16324a2165c74fa4548c45410fd1177fb66929adee8732a572a90301',
	'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol': '995cac2d2b605782625d4d84126569bb3a13c6f37b17a91c9d2c3badba80df38',
	'solidity/contracts/statoblast/EscalationGameEscrow.sol': 'd825a73d0f32f5ca16230d07c57a5165624c2a8e38d43a1032ff369929197546',
	'solidity/contracts/statoblast/EscalationGameSettlement.sol': 'f4bd05d85d0e68c8bd99e87cfe388bc4f0d05723e6ed9df892ed594f53051769',
	'solidity/contracts/statoblast/EscalationGameState.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/EscalationGameStorage.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/SecurityPool.sol': '9dacc34dd469b2f6dce254c4024d2e6dd2b11878c6b9c9b7dfc80e85d7a7640d',
	'solidity/contracts/statoblast/SecurityPoolForker.sol': 'dc42ece125303c4b34ec5b06f287d70376743ec0cad2ff373877746ac29bb106',
	'solidity/contracts/statoblast/factories/SecurityPoolFactory.sol': '814d03c9e5a33ecb7a4c16e495470c17bee1111f7c15c0ffea19f424e72636ec',
	'solidity/contracts/statoblast/tokens/ERC1155.sol': '7bb87695bc3df8fa177c545209ed58d2e4571c19c869b5598bb0a829e764b218',
	'solidity/contracts/statoblast/tokens/ShareToken.sol': '68c370c22a6da29cf139846ea2fdf86f9922027ee6d46e2618de0dcdb7bc5e5f',
	'solidity/contracts/vendor/authorization/ERC20Authorization.sol': '6bfae34f9210ed80f176774eb2b5a3624060ce4be34825ca84949ddcfb8024d2',
}
export const readDeclarationExclusionsBySource: Record<string, string[]> = {
	'solidity/contracts/statoblast/tokens/ShareToken.sol': ['forkController', 'forkPortfolioTime', 'settlement'],
	'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol': ['securityPool', 'securityPoolForker', 'systemState', 'forkData'],
	'solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol': ['storedGame', 'disputeHistory'],
	'solidity/contracts/statoblast/SecurityPool.sol': ['eventEmitter', 'factory', 'operationsDelegate'],
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
