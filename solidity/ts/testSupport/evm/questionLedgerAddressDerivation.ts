import { concatHex, encodeAbiParameters, getCreate2Address, getCreateAddress, keccak256, toHex, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { getCallerScopedSalt } from './callerScopedSalt'

type QuestionLedgerCoreAddresses = {
	escalationGameFactory: Address
	escalationGameProofVerifier: Address
	openOracle: Address
	sharedPoolPriceFeedDeploymentWorker: Address
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
	getSharedPoolPriceFeedInitCode: (securityPool: Address, initialReportPriorityFeeAttoEthPerGas: bigint) => Hex
	getRepTokenAddress: (universeId: bigint) => Address
	getQuestionLedgerInitCode: (inputs: {
		escalationGameFactory: Address
		openOracle: Address
		parent: Address
		sharedPriceFeed: Address
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
		const implementation = getCreate2Address({
			bytecode: config.getSharedPoolPriceFeedInitCode(securityPool, initialReportPriorityFeeAttoEthPerGas),
			from: infraContracts.sharedPoolPriceFeedDeploymentWorker,
			salt: keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], [infraContracts.sharedPoolPriceFeedFactory, infraContracts.securityPoolFactory, securityPool])),
		})
		const runtime = concatHex(['0x363d3d373d3d3d363d73', implementation, '0x5af43d82803e903d91602b57fd5bf3', concatHex([toHex(universeId, { size: 31 }), repToken])])
		const sharedPriceFeed = getCreate2Address({
			bytecode: concatHex(['0x3d61', toHex(96, { size: 2 }), '0x80600b3d3981f3', runtime]),
			from: infraContracts.sharedPoolPriceFeedDeploymentWorker,
			salt: getCallerScopedSalt(infraContracts.sharedPoolPriceFeedFactory, getCallerScopedSalt(infraContracts.securityPoolFactory, keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint248' }], [securityPool, universeId])))),
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
				sharedPriceFeed,
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
			sharedPriceFeed,
			questionLedger,
			shareToken,
		}
	}

	return {
		getQuestionLedgerAddresses,
	}
}
