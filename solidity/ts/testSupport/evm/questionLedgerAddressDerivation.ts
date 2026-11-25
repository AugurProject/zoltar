import { encodeAbiParameters, getCreate2Address, getCreateAddress, keccak256, toHex, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'

type QuestionLedgerCoreAddresses = {
	escalationGameFactory: Address
	escalationGameProofVerifier: Address
	openOracle: Address
	sharedPoolPriceFeedFactory: Address
	securityPoolFactory: Address
	questionForker: Address
	shareTokenFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}

type QuestionLedgerAddressConfig = {
	getEscalationGameInitCode: (questionLedger: Address, repToken: Address, proofVerifier: Address) => Hex
	getInfraContracts: () => QuestionLedgerCoreAddresses
	getPriceFeedAddress: (securityPool: Address, universeId: bigint, priorityFee: bigint) => Address
	getRepTokenAddress: (universeId: bigint) => Address
	getQuestionLedgerInitCode: (inputs: {
		escalationGameFactory: Address
		openOracle: Address
		parent: Address
		priceFeed: Address
		questionId: bigint
		statoblastSecurityMultiplierBps: bigint
		securityPoolFactory: Address
		questionForker: Address
		shareToken: Address
		universeId: bigint
		zoltar: Address
		zoltarQuestionData: Address
	}) => Hex
	getShareTokenInitCode: (securityPoolFactory: Address, zoltarAddress: Address, questionId: bigint) => Hex
}

function getQuestionLedgerOriginId(originUniverseId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas = DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) {
	return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint248' }], [questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, originUniverseId]))
}

function getQuestionLedgerDeployerAddress(securityPoolFactory: Address) {
	return getCreateAddress({
		from: securityPoolFactory,
		// The factory creates only its deployment helper.
		nonce: 1n,
	})
}

function getQuestionLedgerDeploymentWorkerAddress(securityPoolFactory: Address) {
	return getCreateAddress({
		from: getQuestionLedgerDeployerAddress(securityPoolFactory),
		// The fixed event emitter is deployed separately; the worker is the first child.
		nonce: 1n,
	})
}

export function createQuestionLedgerAddressHelper(config: QuestionLedgerAddressConfig) {
	const getQuestionLedgerAddresses = (parent: Address, universeId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, originUniverseId = 0n, initialReportPriorityFeeAttoEthPerGas = DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, securityPool = zeroAddress) => {
		const infraContracts = config.getInfraContracts()
		const originId =
			securityPool === zeroAddress
				? getQuestionLedgerOriginId(originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas)
				: keccak256(
						encodeAbiParameters(
							[{ type: 'bytes32' }, { type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
							[keccak256(toHex('Statoblast security pool origin')), securityPool, originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas],
						),
					)
		const repToken = config.getRepTokenAddress(universeId)
		const priceFeed = config.getPriceFeedAddress(securityPool, universeId, initialReportPriorityFeeAttoEthPerGas)
		const shareToken = getCreate2Address({
			bytecode: config.getShareTokenInitCode(infraContracts.securityPoolFactory, infraContracts.zoltar, questionId),
			from: infraContracts.shareTokenFactory,
			salt: originId,
		})
		const questionLedger = getCreate2Address({
			bytecode: config.getQuestionLedgerInitCode({
				escalationGameFactory: infraContracts.escalationGameFactory,
				openOracle: infraContracts.openOracle,
				parent,
				priceFeed,
				questionId,
				statoblastSecurityMultiplierBps,
				securityPoolFactory: infraContracts.securityPoolFactory,
				questionForker: infraContracts.questionForker,
				shareToken,
				universeId,
				zoltar: infraContracts.zoltar,
				zoltarQuestionData: infraContracts.zoltarQuestionData,
			}),
			from: getQuestionLedgerDeploymentWorkerAddress(infraContracts.securityPoolFactory),
			salt: toHex(0, { size: 32 }),
		})
		const escalationGame = getCreate2Address({
			bytecode: config.getEscalationGameInitCode(questionLedger, repToken, infraContracts.escalationGameProofVerifier),
			from: infraContracts.escalationGameFactory,
			salt: toHex(0, { size: 32 }),
		})

		return {
			escalationGame,
			priceFeed,
			questionLedger,
			shareToken,
		}
	}

	return {
		getQuestionLedgerAddresses,
	}
}
