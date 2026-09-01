import { encodeAbiParameters, getAddress, getCreate2Address, getCreateAddress, keccak256, numberToBytes, zeroAddress, type Address, type Hex } from './ethereum.js'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from './oracleInitialReport.js'

type SecurityPoolCoreAddresses = {
	escalationGameFactory: Address
	escalationGameProofVerifier: Address
	openOracle: Address
	priceOracleManagerAndOperatorQueuerFactory: Address
	securityPoolFactory: Address
	securityPoolForker: Address
	shareTokenFactory: Address
	uniformPriceDualCapBatchAuctionFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}

type RepTokenAddressConfig = {
	genesisRepTokenAddress: Address
	getReputationTokenInitCode: (zoltarAddress: Address) => Hex
	getZoltarAddress: () => Address
}

type SecurityPoolAddressConfig = {
	getEscalationGameInitCode: (securityPool: Address, repToken: Address, proofVerifier: Address) => Hex
	getInfraContracts: () => SecurityPoolCoreAddresses
	getPriceOracleManagerAndOperatorQueuerInitCode: (openOracle: Address, repToken: Address, initialReportPriorityFeeAttoEthPerGas: bigint) => Hex
	getRepTokenAddress: (universeId: bigint) => Address
	getSecurityPoolInitCode: (inputs: {
		escalationGameFactory: Address
		openOracle: Address
		parent: Address
		priceOracleManagerAndOperatorQueuer: Address
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

function deriveRepTokenAddress(universeId: bigint, genesisRepTokenAddress: Address, zoltarAddress: Address, reputationTokenInitCode: Hex): Address {
	if (universeId === 0n) return getAddress(genesisRepTokenAddress)

	return getCreate2Address({
		from: zoltarAddress,
		salt: numberToBytes(universeId, { size: 32 }),
		bytecodeHash: keccak256(reputationTokenInitCode),
	})
}

function getSecurityPoolSalt(parent: Address, universeId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint) {
	return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas]))
}

export function getSecurityPoolOriginId(originUniverseId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas = DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) {
	return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint248' }], [questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, originUniverseId]))
}

export function getCallerScopedSalt(caller: Address, salt: Hex) {
	return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [caller, salt]))
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
		// The deployer creates the event emitter, then its deployment worker.
		nonce: 2n,
	})
}

export function createRepTokenAddressHelper(config: RepTokenAddressConfig) {
	const getRepTokenAddress = (universeId: bigint) => {
		const zoltarAddress = config.getZoltarAddress()
		return deriveRepTokenAddress(universeId, config.genesisRepTokenAddress, zoltarAddress, config.getReputationTokenInitCode(zoltarAddress))
	}

	return {
		getRepTokenAddress,
	}
}

export function createSecurityPoolAddressHelper(config: SecurityPoolAddressConfig) {
	const getSecurityPoolAddresses = (parent: Address, universeId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, originUniverseId = 0n, initialReportPriorityFeeAttoEthPerGas = DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) => {
		const infraContracts = config.getInfraContracts()
		const securityPoolSalt = getSecurityPoolSalt(parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas)
		const securityPoolSaltWithMsgSender = getCallerScopedSalt(infraContracts.securityPoolFactory, securityPoolSalt)

		const repToken = config.getRepTokenAddress(universeId)
		const priceOracleManagerAndOperatorQueuer = getCreate2Address({
			bytecode: config.getPriceOracleManagerAndOperatorQueuerInitCode(infraContracts.openOracle, repToken, initialReportPriorityFeeAttoEthPerGas),
			// The factory creates the registry deployer first and the coordinator
			// deployment worker second in its constructor.
			from: getCreateAddress({ from: infraContracts.priceOracleManagerAndOperatorQueuerFactory, nonce: 2n }),
			salt: securityPoolSaltWithMsgSender,
		})
		const shareToken = getCreate2Address({
			bytecode: config.getShareTokenInitCode(infraContracts.securityPoolFactory, infraContracts.zoltar, questionId),
			from: infraContracts.shareTokenFactory,
			salt: getSecurityPoolOriginId(originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas),
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
				priceOracleManagerAndOperatorQueuer,
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
			salt: numberToBytes(0, { size: 32 }),
		})
		const escalationGame = getCreate2Address({
			bytecode: config.getEscalationGameInitCode(securityPool, repToken, infraContracts.escalationGameProofVerifier),
			from: infraContracts.escalationGameFactory,
			salt: numberToBytes(0, { size: 32 }),
		})

		return {
			escalationGame,
			priceOracleManagerAndOperatorQueuer,
			securityPool,
			shareToken,
			truthAuction,
		}
	}

	return {
		getSecurityPoolAddresses,
	}
}
