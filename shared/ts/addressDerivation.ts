import { encodeAbiParameters, getAddress, getCreate2Address, keccak256, numberToBytes, zeroAddress, type Address, type Hex } from 'viem'

type SecurityPoolAddressDerivationInputs = {
	infraContracts: {
		escalationGameFactory: Address
		priceOracleManagerAndOperatorQueuerFactory: Address
		securityPoolFactory: Address
		shareTokenFactory: Address
		uniformPriceDualCapBatchAuctionFactory: Address
	}
	parent: Address
	getEscalationGameInitCode: (securityPool: Address) => Hex
	getPriceOracleManagerAndOperatorQueuerInitCode: (repToken: Address) => Hex
	repToken: Address
	questionId: bigint
	securityMultiplier: bigint
	getSecurityPoolInitCode: (priceOracleManagerAndOperatorQueuer: Address, shareToken: Address, truthAuction: Address) => Hex
	getShareTokenInitCode: () => Hex
	getTruthAuctionInitCode: () => Hex
	universeId: bigint
}

type AddressDerivationConfig = {
	customGetRepTokenAddress?: (universeId: bigint) => Address
	genesisRepTokenAddress: Address
	getEscalationGameInitCode: (securityPool: Address) => Hex
	getInfraContracts: () => SecurityPoolAddressDerivationInputs['infraContracts'] & {
		openOracle: Address
		securityPoolForker: Address
		zoltar: Address
		zoltarQuestionData: Address
	}
	getPriceOracleManagerAndOperatorQueuerInitCode: (openOracle: Address, repToken: Address) => Hex
	getReputationTokenInitCode: (zoltarAddress: Address) => Hex
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
	getZoltarAddress: () => Address
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

function deriveSecurityPoolAddresses({
	infraContracts,
	parent,
	getEscalationGameInitCode,
	getPriceOracleManagerAndOperatorQueuerInitCode,
	questionId,
	repToken,
	securityMultiplier,
	getSecurityPoolInitCode,
	getShareTokenInitCode,
	getTruthAuctionInitCode,
	universeId,
}: SecurityPoolAddressDerivationInputs) {
	const securityPoolSalt = getSecurityPoolSalt(parent, universeId, questionId, securityMultiplier)
	const securityPoolSaltWithMsgSender = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [infraContracts.securityPoolFactory, securityPoolSalt]))

	const priceOracleManagerAndOperatorQueuer = getCreate2Address({
		bytecode: getPriceOracleManagerAndOperatorQueuerInitCode(repToken),
		from: infraContracts.priceOracleManagerAndOperatorQueuerFactory,
		salt: securityPoolSaltWithMsgSender,
	})
	const shareToken = getCreate2Address({
		bytecode: getShareTokenInitCode(),
		from: infraContracts.shareTokenFactory,
		salt: getShareTokenSalt(questionId, securityMultiplier),
	})
	const truthAuction =
		parent === zeroAddress
			? zeroAddress
			: getCreate2Address({
					bytecode: getTruthAuctionInitCode(),
					from: infraContracts.uniformPriceDualCapBatchAuctionFactory,
					salt: securityPoolSalt,
				})
	const securityPool = getCreate2Address({
		bytecode: getSecurityPoolInitCode(priceOracleManagerAndOperatorQueuer, shareToken, truthAuction),
		from: infraContracts.securityPoolFactory,
		salt: numberToBytes(0, { size: 32 }),
	})
	const escalationGame = getCreate2Address({
		bytecode: getEscalationGameInitCode(securityPool),
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

export function createAddressDerivationHelpers(config: AddressDerivationConfig) {
	const derivedGetRepTokenAddress = (universeId: bigint) => {
		const zoltarAddress = config.getZoltarAddress()
		return deriveRepTokenAddress(universeId, config.genesisRepTokenAddress, zoltarAddress, config.getReputationTokenInitCode(zoltarAddress))
	}

	const getRepTokenAddress = config.customGetRepTokenAddress ?? derivedGetRepTokenAddress

	const getSecurityPoolAddresses = (parent: Address, universeId: bigint, questionId: bigint, securityMultiplier: bigint) => {
		const infraContracts = config.getInfraContracts()
		return deriveSecurityPoolAddresses({
			infraContracts: {
				escalationGameFactory: infraContracts.escalationGameFactory,
				priceOracleManagerAndOperatorQueuerFactory: infraContracts.priceOracleManagerAndOperatorQueuerFactory,
				securityPoolFactory: infraContracts.securityPoolFactory,
				shareTokenFactory: infraContracts.shareTokenFactory,
				uniformPriceDualCapBatchAuctionFactory: infraContracts.uniformPriceDualCapBatchAuctionFactory,
			},
			parent,
			getEscalationGameInitCode: config.getEscalationGameInitCode,
			getPriceOracleManagerAndOperatorQueuerInitCode: repToken => config.getPriceOracleManagerAndOperatorQueuerInitCode(infraContracts.openOracle, repToken),
			getSecurityPoolInitCode: (priceOracleManagerAndOperatorQueuer, shareToken, truthAuction) =>
				config.getSecurityPoolInitCode({
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
			getShareTokenInitCode: () => config.getShareTokenInitCode(infraContracts.securityPoolFactory, infraContracts.zoltar, questionId),
			getTruthAuctionInitCode: () => config.getTruthAuctionInitCode(infraContracts.securityPoolForker),
			repToken: getRepTokenAddress(universeId),
			questionId,
			securityMultiplier,
			universeId,
		})
	}

	return {
		getRepTokenAddress,
		getSecurityPoolAddresses,
	}
}
