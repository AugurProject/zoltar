import { encodeAbiParameters, getAddress, getCreate2Address, keccak256, numberToBytes, zeroAddress, type Address, type Hex } from 'viem'

type SecurityPoolCoreAddresses = {
	escalationGameFactory: Address
	openOracle: Address
	priceOracleManagerAndOperatorQueuerFactory: Address
	securityPoolFactory: Address
	securityPoolForker: Address
	shareTokenFactory: Address
	uniformPriceDualCapBatchAuctionFactory: Address
	weth: Address
	zoltar: Address
	zoltarQuestionData: Address
}

type RepTokenAddressConfig = {
	genesisRepTokenAddress: Address
	getReputationTokenInitCode: (zoltarAddress: Address) => Hex
	getZoltarAddress: () => Address
}

type SecurityPoolAddressConfig = {
	getEscalationGameInitCode: (securityPool: Address) => Hex
	getInfraContracts: () => SecurityPoolCoreAddresses
	getPriceOracleManagerAndOperatorQueuerInitCode: (openOracle: Address, repToken: Address, weth: Address) => Hex
	getRepTokenAddress: (universeId: bigint) => Address
	getSecurityPoolInitCode: (inputs: {
		escalationGameFactory: Address
		openOracle: Address
		parent: Address
		priceOracleManagerAndOperatorQueuer: Address
		questionId: bigint
		securityMultiplier: bigint
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

function getSecurityPoolSalt(parent: Address, universeId: bigint, questionId: bigint, securityMultiplier: bigint) {
	return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint256' }], [parent, universeId, questionId, securityMultiplier]))
}

function getShareTokenSalt(questionId: bigint, securityMultiplier: bigint) {
	return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [securityMultiplier, questionId]))
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
	const getSecurityPoolAddresses = (parent: Address, universeId: bigint, questionId: bigint, securityMultiplier: bigint) => {
		const infraContracts = config.getInfraContracts()
		const securityPoolSalt = getSecurityPoolSalt(parent, universeId, questionId, securityMultiplier)
		const securityPoolSaltWithMsgSender = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [infraContracts.securityPoolFactory, securityPoolSalt]))

		const repToken = config.getRepTokenAddress(universeId)
		const priceOracleManagerAndOperatorQueuer = getCreate2Address({
			bytecode: config.getPriceOracleManagerAndOperatorQueuerInitCode(infraContracts.openOracle, repToken, infraContracts.weth),
			from: infraContracts.priceOracleManagerAndOperatorQueuerFactory,
			salt: securityPoolSaltWithMsgSender,
		})
		const shareToken = getCreate2Address({
			bytecode: config.getShareTokenInitCode(infraContracts.securityPoolFactory, infraContracts.zoltar, questionId),
			from: infraContracts.shareTokenFactory,
			salt: getShareTokenSalt(questionId, securityMultiplier),
		})
		const truthAuction =
			parent === zeroAddress
				? zeroAddress
				: getCreate2Address({
						bytecode: config.getTruthAuctionInitCode(infraContracts.securityPoolForker),
						from: infraContracts.uniformPriceDualCapBatchAuctionFactory,
						salt: securityPoolSalt,
					})
		const securityPool = getCreate2Address({
			bytecode: config.getSecurityPoolInitCode({
				escalationGameFactory: infraContracts.escalationGameFactory,
				openOracle: infraContracts.openOracle,
				parent,
				priceOracleManagerAndOperatorQueuer,
				questionId,
				securityMultiplier,
				securityPoolFactory: infraContracts.securityPoolFactory,
				securityPoolForker: infraContracts.securityPoolForker,
				shareToken,
				truthAuction,
				universeId,
				zoltar: infraContracts.zoltar,
				zoltarQuestionData: infraContracts.zoltarQuestionData,
			}),
			from: infraContracts.securityPoolFactory,
			salt: numberToBytes(0, { size: 32 }),
		})
		const escalationGame = getCreate2Address({
			bytecode: config.getEscalationGameInitCode(securityPool),
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
