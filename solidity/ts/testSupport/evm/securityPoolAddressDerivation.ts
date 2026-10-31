import { encodeAbiParameters, getCreate2Address, getCreateAddress, keccak256, toHex, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { getCallerScopedSalt } from './callerScopedSalt'

type SecurityPoolCoreAddresses = {
	escalationGameFactory: Address
	escalationGameProofVerifier: Address
	openOracle: Address
	openOraclePriceCoordinatorFactory: Address
	priceCoordinatorDeploymentWorker: Address
	securityPoolFactory: Address
	securityPoolForker: Address
	shareTokenFactory: Address
	uniformPriceDualCapBatchAuctionFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}

type SecurityPoolAddressConfig = {
	getEscalationGameInitCode: (securityPool: Address, repToken: Address, proofVerifier: Address) => Hex
	getInfraContracts: () => SecurityPoolCoreAddresses
	getOpenOraclePriceCoordinatorInitCode: (openOracle: Address, repToken: Address, initialReportPriorityFeeAttoEthPerGas: bigint) => Hex
	getRepTokenAddress: (universeId: bigint) => Address
	getSecurityPoolInitCode: (inputs: {
		escalationGameFactory: Address
		openOracle: Address
		parent: Address
		openOraclePriceCoordinator: Address
		questionId: bigint
		statoblastSecurityMultiplierBps: bigint
		securityPoolFactory: Address
		securityPoolForker: Address
		shareToken: Address
		truthAuction: Address
		universeId: bigint
		zoltar: Address
		zoltarQuestionData: Address
	}) => Hex
	getShareTokenInitCode: (securityPoolFactory: Address, zoltarAddress: Address, questionId: bigint) => Hex
	getTruthAuctionInitCode: (securityPoolForker: Address) => Hex
}

function getSecurityPoolSalt(parent: Address, universeId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint) {
	return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas]))
}

function getSecurityPoolOriginId(originUniverseId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas = DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) {
	return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint248' }], [questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, originUniverseId]))
}

function getSecurityPoolDeployerAddress(securityPoolFactory: Address) {
	return getCreateAddress({
		from: securityPoolFactory,
		// The factory creates only its deployment helper.
		nonce: 1n,
	})
}

function getSecurityPoolDeploymentWorkerAddress(securityPoolFactory: Address) {
	return getCreateAddress({
		from: getSecurityPoolDeployerAddress(securityPoolFactory),
		// The fixed event emitter is deployed separately; the worker is the first child.
		nonce: 1n,
	})
}

export function createSecurityPoolAddressHelper(config: SecurityPoolAddressConfig) {
	const getSecurityPoolAddresses = (parent: Address, universeId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, originUniverseId = 0n, initialReportPriorityFeeAttoEthPerGas = DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, portfolio = zeroAddress) => {
		const infraContracts = config.getInfraContracts()
		const originId =
			portfolio === zeroAddress
				? getSecurityPoolOriginId(originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas)
				: keccak256(
						encodeAbiParameters(
							[{ type: 'bytes32' }, { type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
							[keccak256(toHex('Statoblast portfolio origin')), portfolio, originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas],
						),
					)
		const securityPoolSalt = portfolio !== zeroAddress && parent === zeroAddress ? originId : getSecurityPoolSalt(parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas)
		const securityPoolSaltWithMsgSender = getCallerScopedSalt(infraContracts.securityPoolFactory, securityPoolSalt)

		const repToken = config.getRepTokenAddress(universeId)
		const openOraclePriceCoordinator = getCreate2Address({
			bytecode: config.getOpenOraclePriceCoordinatorInitCode(infraContracts.openOracle, repToken, initialReportPriorityFeeAttoEthPerGas),
			// The shared worker authenticates configuration to each deploying factory.
			from: infraContracts.priceCoordinatorDeploymentWorker,
			salt: getCallerScopedSalt(infraContracts.openOraclePriceCoordinatorFactory, securityPoolSaltWithMsgSender),
		})
		const shareToken = getCreate2Address({
			bytecode: config.getShareTokenInitCode(infraContracts.securityPoolFactory, infraContracts.zoltar, questionId),
			from: infraContracts.shareTokenFactory,
			salt: originId,
		})
		const truthAuction =
			parent === zeroAddress
				? zeroAddress
				: getCreate2Address({
						bytecode: config.getTruthAuctionInitCode(infraContracts.securityPoolForker),
						from: infraContracts.uniformPriceDualCapBatchAuctionFactory,
						salt: securityPoolSaltWithMsgSender,
					})
		const securityPool = getCreate2Address({
			bytecode: config.getSecurityPoolInitCode({
				escalationGameFactory: infraContracts.escalationGameFactory,
				openOracle: infraContracts.openOracle,
				parent,
				openOraclePriceCoordinator,
				questionId,
				statoblastSecurityMultiplierBps,
				securityPoolFactory: infraContracts.securityPoolFactory,
				securityPoolForker: infraContracts.securityPoolForker,
				shareToken,
				truthAuction,
				universeId,
				zoltar: infraContracts.zoltar,
				zoltarQuestionData: infraContracts.zoltarQuestionData,
			}),
			from: getSecurityPoolDeploymentWorkerAddress(infraContracts.securityPoolFactory),
			salt: toHex(0, { size: 32 }),
		})
		const escalationGame = getCreate2Address({
			bytecode: config.getEscalationGameInitCode(securityPool, repToken, infraContracts.escalationGameProofVerifier),
			from: infraContracts.escalationGameFactory,
			salt: toHex(0, { size: 32 }),
		})

		return {
			escalationGame,
			openOraclePriceCoordinator,
			securityPool,
			shareToken,
			truthAuction,
		}
	}

	return {
		getSecurityPoolAddresses,
	}
}
