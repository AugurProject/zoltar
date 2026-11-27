import assert from 'node:assert/strict'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'
export const entrypointSignaturesBySource: Record<string, Record<string, string[]>> = {
	'solidity/contracts/ZoltarQuestionData.sol': {
		createQuestion: ['external(QuestionData,string[])'],
	},
	'solidity/contracts/Zoltar.sol': {
		forkUniverse: ['external(uint248,uint256,uint256)'],
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
		deploySecurityPool: ['external(bytes,bytes)'],
		initializeSecurityPoolPriceFeed: ['external(uint248,uint256)'],
		initializeSecurityPoolPriceFeedForUniverse: ['external(uint248)'],
		prepareSecurityPoolPriceFeed: ['external(IQuestionLedger,uint248)'],
		deploySecurityPoolQuestionLedger: ['external(uint248,uint256,uint256,uint256)'],
		prepareSecurityPoolChildPriceFeed: ['external(IQuestionLedger,uint256)'],
		deployChildQuestionLedger: ['external(IQuestionLedger,IShareToken,uint248,uint256,uint256)'],
	},
	'solidity/contracts/statoblast/QuestionLedger.sol': {
		setSecurityPoolCustody: ['external(address)'],
		creditEscalationSurplus: ['external(uint256)'],
		refreshSecurityPoolFees: ['public()'],
		burnEscalationWinnerHaircut: ['external(uint256)'],
		createCompleteSet: ['external(uint256,address,uint256,uint256,uint256)'],
		redeemCompleteSet: ['external(uint256)'],
		redeemShares: ['external()'],
		depositWalletRepToEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		depositWalletRepToEscalationGameWithLead: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		withdrawFromEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256[])'],
		withdrawForkedEscalationDeposits: ['external(QuestionOutcome,CarriedDepositProof[])'],
		updateSettlementCollateral: ['public()'],
		setStartingParams: ['external()'],
		activateForkMode: ['external()'],
		initializeForkedEscalationGame: ['external(uint256,uint256,int256,BinaryOutcomes.BinaryOutcome)'],
		initializeForkCarryOutcome: ['external(address,bytes32,bytes32[64],uint256,uint256,uint256)'],
		resumeForkedEscalationGame: ['external()'],
		setAwaitingForkContinuation: ['external(bool)'],
		setSystemState: ['external(SystemState)'],
		authorizeChildQuestionLedger: ['external(IQuestionLedger)'],
	},
	'solidity/contracts/statoblast/QuestionForker.sol': {
		prepareSecurityPoolQuestion: ['external(IQuestionLedger,uint248)'],
		materializeSecurityPoolQuestion: ['public(IQuestionLedger,uint248)'],
		initiateQuestionLedgerFork: ['external(IQuestionLedger)'],
		forkZoltarWithOwnEscalationGame: ['external(IQuestionLedger)'],
		createChildUniverse: ['external(IQuestionLedger,uint256)'],
	},
	'solidity/contracts/statoblast/EscalationGame.sol': {
		start: ['external(uint256,uint256)'],
		startFromFork: ['external(uint256,uint256,int256,BinaryOutcomes.BinaryOutcome,bool,uint256)'],
		resumeFromFork: ['external()'],
		depositRepOnOutcome: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		depositRepOnOutcomeWithLead: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		depositRepOnOutcomeWithAuthorizationAndLead: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'],
		recordDepositFromQuestionLedger: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256)'],
	},
	'solidity/contracts/statoblast/EscalationGameSettlement.sol': {
		withdrawDeposit: ['public(CarriedDepositProof,BinaryOutcomes.BinaryOutcome)', 'public(uint256,BinaryOutcomes.BinaryOutcome)'],
		settleOrdinaryGame: ['external()'],
		sweepResidualRepToQuestionLedger: ['external()'],
	},
	'solidity/contracts/statoblast/EscalationGameCarry.sol': {
		initializeForkCarryOutcome: ['external(address,bytes32,bytes32[64],uint256,uint256,uint256)'],
	},
	'solidity/contracts/statoblast/SharedPoolPriceFeed.sol': {
		requestSecurityPoolPrice: ['external(uint256,uint256,uint256)'],
		requestSecurityPoolPriceWithOperations: ['external(uint256,uint256,uint256,IReportOperations.Batch)'],
		createReportEscrow: ['external(address,address,uint256,uint256,uint256,uint256,uint32)'],
		settleReport: ['external(uint256,uint256,uint256)'],
		recoverReport: ['public(uint256)'],
		recoverSettledPendingReport: ['external()'],
	},
	'solidity/contracts/statoblast/tokens/ERC1155.sol': {
		setApprovalForAll: ['external(address,bool)'],
		safeTransferFrom: ['external(address,address,uint256,uint256,bytes)'],
		safeBatchTransferFrom: ['external(address,address,uint256[],uint256[],bytes)'],
	},
	'solidity/contracts/statoblast/tokens/ShareToken.sol': {
		transferSecurityPoolRecoveryRights: ['external(uint248,address,uint256[3])'],
		consumeSecurityPoolRecoveryCompleteSets: ['external(uint248,address,uint256)'],
		migrate: ['external(uint256,uint256[])'],
		authorize: ['external(IQuestionLedger)'],
		mintCompleteSets: ['external(uint248,address,uint256)'],
		burnCompleteSets: ['external(uint248,address,uint256)'],
		burnTokenIdAndGetRemainingSupply: ['external(uint256,address)'],
	},
}
export const fallbackRoutedEntrypointSignatures: Record<string, Record<string, Record<string, string[]>>> = {
	'solidity/contracts/statoblast/EscalationGame.sol': {
		'solidity/contracts/statoblast/EscalationGameDepositDelegate.sol': {
			depositRepOnOutcomeWithAuthorization: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'],
			depositRepOnOutcomeWithPermit: ['public(BinaryOutcomes.BinaryOutcome,uint256,uint256,uint8,bytes32,bytes32)'],
			depositRepOnOutcomeWithPermitAndLead: ['external(BinaryOutcomes.BinaryOutcome,uint256,uint256,uint8,bytes32,bytes32)'],
		},
	},
}
export const interfaceEntrypointExclusionsBySource: Record<string, string[]> = {
	'solidity/contracts/statoblast/SharedPoolPriceFeed.sol': ['onSharedPriceAccepted'],
	// Purchase funding is a callback implemented by Services, not a QuestionLedger entrypoint.
	'solidity/contracts/statoblast/QuestionLedger.sol': ['completePurchaseFunding'],
}
export const stateChangingAbiFingerprintBySource: Record<string, string> = {
	'solidity/contracts/ERC20.sol': '6c4161bf27a2ed1bc2de94b58253a8ec4201e28d125571cb2124238753387a22',
	'solidity/contracts/ReputationToken.sol': '30c2987453109942297ab8ee8256c53fc68cd5c22f9fd16e168cd6bbb12b8608',
	'solidity/contracts/Zoltar.sol': '3e8a91c87033153f919faaafdf5c6d4cbcc0eaf9564ed0108f9cbdb939ed026f',
	'solidity/contracts/ZoltarQuestionData.sol': '904b4369195f070fa3b04bbcbc1acba529810ffa2da4667569cd9168ac568d65',
	'solidity/contracts/statoblast/EscalationGame.sol': 'ace27e1a535bc7d088e2634d1d30c96644c610ad9a9fb014e3fc31e036d4d63a',
	'solidity/contracts/statoblast/EscalationGameCalculations.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/EscalationGameCarry.sol': '0bc75d6da4992bbee67b513a4c4046d1057c325a735ca4c50e2b680be6627210',
	'solidity/contracts/statoblast/EscalationGameSettlement.sol': '25d6c89aa4959542f2598476b3a0875c4e912241961b792338a9da178909fd34',
	'solidity/contracts/statoblast/EscalationGameState.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/EscalationGameStorage.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/SharedPoolPriceFeed.sol': 'f6f6deedaecdd082a765b58de7b631187371fd64cb621bb62bfa7f3ecf024bde',
	'solidity/contracts/statoblast/QuestionLedger.sol': '9b5e6403b00caa93dc2d421226187c2367c056bc16b5d581f7208ace849f0222',
	'solidity/contracts/statoblast/QuestionForker.sol': '04e488e9cd2e23d2a7b9a0a052180fdd7ec2dfa1cded5445bf142ae78e8af15b',
	'solidity/contracts/statoblast/factories/SecurityPoolFactory.sol': '24a5c8cc53cbe4c2c3a9ad75e52d462010f1f91f40172fd416a2d3573849aa18',
	'solidity/contracts/statoblast/tokens/ERC1155.sol': 'b844f1985ddaa7d364d1fa2a4a145a8f8ea1c2506dc625a4c68a485d5148da21',
	'solidity/contracts/statoblast/tokens/ShareToken.sol': 'e1eb94e04ee65aa3f3f1147cdf1be9a855e30e7ba5900e6f8e048107d92cc400',
	'solidity/contracts/vendor/authorization/ERC20Authorization.sol': '6bfae34f9210ed80f176774eb2b5a3624060ce4be34825ca84949ddcfb8024d2',
}
export const readDeclarationExclusionsBySource: Record<string, string[]> = {
	'solidity/contracts/statoblast/tokens/ShareToken.sol': ['forkController', 'forkSecurityPoolTime', 'isReady', 'settlement'],
	'solidity/contracts/statoblast/SharedPoolPriceFeed.sol': [
		'weth',
		'targetPriceErrorForDispute',
		'settlementTime',
		'disputeDelay',
		'protocolFee',
		'feePercentage',
		'multiplier',
		'protocolFeeRecipient',
		'escalationHaltMultiplierBps',
		'maxSettlementBaseFeeMultiplierBps',
		'capitalLedger',
		'oracleExposure',
		'oracleRepExposure',
		'isPriceReportingOpen',
	],
	'solidity/contracts/statoblast/QuestionLedger.sol': ['accountingModule', 'factory', 'operationsDelegate', 'questionAdmissionPolicy', 'originUniverseId'],
}
export function assertCoordinatorDataFunctionInventory(coordinatorData: string, compiledContractArtifacts: unknown): void {
	const coordinatorIndex: unknown = JSON.parse(coordinatorData)
	assert.ok(isPlainRecord(coordinatorIndex))
	const documentedFunctions = coordinatorIndex['functions']
	assert.ok(isPlainRecord(documentedFunctions), 'Coordinator data must provide its complete function inventory')
	assert.ok(isPlainRecord(compiledContractArtifacts))
	const contracts = compiledContractArtifacts['contracts']
	assert.ok(isPlainRecord(contracts))
	const coordinatorSource = contracts['contracts/statoblast/SharedPoolPriceFeed.sol']
	assert.ok(isPlainRecord(coordinatorSource))
	const coordinatorArtifact = coordinatorSource['SharedPoolPriceFeed']
	assert.ok(isPlainRecord(coordinatorArtifact))
	const abi = coordinatorArtifact['abi']
	assert.ok(Array.isArray(abi))
	const compiledFunctionNames = Array.from(
		new Set(
			abi.flatMap(entry => {
				if (!isPlainRecord(entry) || entry['type'] !== 'function' || typeof entry['name'] !== 'string') return []
				return [entry['name']]
			}),
		),
	).sort()
	assert.deepEqual(Object.keys(documentedFunctions).sort(), compiledFunctionNames, 'Coordinator data function inventory must exactly match the compiled ABI')
	const documentedSignatures = coordinatorIndex['functionSignatures']
	assert.ok(isPlainRecord(documentedSignatures), 'Coordinator data must provide its documented signatures')
	assert.deepEqual(Object.keys(documentedSignatures).sort(), compiledFunctionNames, 'Coordinator signature inventory must exactly match the compiled ABI')
	for (const [name, signature] of Object.entries(documentedSignatures)) {
		const entry: unknown = abi.find(value => isPlainRecord(value) && value['type'] === 'function' && value['name'] === name)
		assert.ok(isPlainRecord(entry), `Unknown documented coordinator function: ${name}`)
		assert.equal(documentedFunctions[name], entry['stateMutability'], `Coordinator mutability must match the compiled ABI: ${name}`)
		const inputs: unknown = entry['inputs']
		assert.ok(Array.isArray(inputs))
		const types = inputs.map((input: unknown) => {
			assert.ok(isPlainRecord(input) && typeof input['type'] === 'string')
			return input['type']
		})
		assert.equal(signature, `${name}(${types.join(',')})`, `Coordinator signature must match the compiled ABI: ${name}`)
	}
}
