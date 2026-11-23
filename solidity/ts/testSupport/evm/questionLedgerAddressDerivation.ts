import { encodeAbiParameters, getCreate2Address, getCreateAddress, keccak256, toHex, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { getCallerScopedSalt } from './callerScopedSalt'

type QuestionLedgerCoreAddresses = {
	escalationGameFactory: Address
	escalationGameProofVerifier: Address
	openOracle: Address
	openOraclePriceCoordinatorFactory: Address
	priceCoordinatorDeploymentWorker: Address
	securityPoolFactory: Address
	questionForker: Address
	shareTokenFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}

type QuestionLedgerAddressConfig = {
	getEscalationGameInitCode: (questionLedger: Address, repToken: Address, proofVerifier: Address) => Hex
	getInfraContracts: () => QuestionLedgerCoreAddresses
	getOpenOraclePriceCoordinatorInitCode: (openOracle: Address, repToken: Address, initialReportPriorityFeeAttoEthPerGas: bigint) => Hex
	getRepTokenAddress: (universeId: bigint) => Address
	getQuestionLedgerInitCode: (inputs: {
		escalationGameFactory: Address
		openOracle: Address
		parent: Address
		openOraclePriceCoordinator: Address
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

function getQuestionLedgerSalt(parent: Address, universeId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint) {
	return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas]))
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
	const getQuestionLedgerAddresses = (parent: Address, universeId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, originUniverseId = 0n, initialReportPriorityFeeAttoEthPerGas = DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, portfolio = zeroAddress) => {
		const infraContracts = config.getInfraContracts()
		const originId =
			portfolio === zeroAddress
				? getQuestionLedgerOriginId(originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas)
				: keccak256(
						encodeAbiParameters(
							[{ type: 'bytes32' }, { type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
							[keccak256(toHex('Statoblast portfolio origin')), portfolio, originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas],
						),
					)
		const questionLedgerSalt = portfolio !== zeroAddress && parent === zeroAddress ? originId : getQuestionLedgerSalt(parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas)
		const questionLedgerSaltWithMsgSender = getCallerScopedSalt(infraContracts.securityPoolFactory, questionLedgerSalt)

		const repToken = config.getRepTokenAddress(universeId)
		const openOraclePriceCoordinator = getCreate2Address({
			bytecode: config.getOpenOraclePriceCoordinatorInitCode(infraContracts.openOracle, repToken, initialReportPriorityFeeAttoEthPerGas),
			// The shared worker authenticates configuration to each deploying factory.
			from: infraContracts.priceCoordinatorDeploymentWorker,
			salt: getCallerScopedSalt(infraContracts.openOraclePriceCoordinatorFactory, questionLedgerSaltWithMsgSender),
		})
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
				openOraclePriceCoordinator,
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
			openOraclePriceCoordinator,
			questionLedger,
			shareToken,
		}
	}

	return {
		getQuestionLedgerAddresses,
	}
}
