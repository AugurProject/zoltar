import { concatHex, encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256, toHex, type Address, type Hex } from 'viem'
import { createApplyLinkedLibrariesHelper, createInfraContractAddressHelper, createZoltarAddressHelpers } from '@zoltar/shared/deploymentAddresses'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/shared/protocolConfig'
import { bigintToAddress } from './helpers.js'
import {
	ScalarOutcomes_ScalarOutcomes,
	Zoltar_Zoltar,
	ZoltarQuestionData_ZoltarQuestionData,
	peripherals_Multicall3_Multicall3,
	peripherals_SecurityPoolForker_SecurityPoolForker,
	peripherals_SecurityPoolUtils_SecurityPoolUtils,
	peripherals_factories_EscalationGameFactory_EscalationGameFactory,
	peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory,
	peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
	peripherals_factories_ShareTokenFactory_ShareTokenFactory,
	peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	peripherals_openOracle_OpenOracle_OpenOracle,
} from '../contractArtifact.js'

export const PROXY_DEPLOYER_ADDRESS = bigintToAddress(0x7a0d94f55792c434d74a40883c6ed8545e406d12n)
export const ZERO_SALT = toHex(0, { size: 32 })
export const MULTICALL3_BYTECODE = `0x${peripherals_Multicall3_Multicall3.evm.bytecode.object}` satisfies Hex
const MAINNET_WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' satisfies Address
const ORACLE_FEE_SINK_ADDRESS = '0x000000000000000000000000000000000000dEaD' satisfies Address
const ORACLE_REPORT_GAS = 100000n
const ORACLE_SETTLEMENT_GAS = 1000000
const ORACLE_EXACT_TOKEN1_REPORT = 250n * 10n ** 18n
const ORACLE_SETTLEMENT_TIME = 40 * 12
const ORACLE_DISPUTE_DELAY = 0
const ORACLE_PROTOCOL_FEE = 100000
const ORACLE_FEE_PERCENTAGE = 10000
const ORACLE_MULTIPLIER = 115
const ORACLE_TIME_TYPE = true
const ORACLE_TRACK_DISPUTES = true
const ORACLE_PROTOCOL_FEE_RECIPIENT = ORACLE_FEE_SINK_ADDRESS
const ORACLE_PRICE_ROUND_BUDGET_MULTIPLIER_BPS = 40000n
const ORACLE_ESCALATION_HALT_MULTIPLIER_BPS = 100000n
const ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS = 30000n
const ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS = 1000n

const getSecurityPoolUtilsAddress = () =>
	getCreate2Address({
		bytecode: `0x${peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`,
		from: PROXY_DEPLOYER_ADDRESS,
		salt: ZERO_SALT,
	})

const getScalarOutcomesAddress = () =>
	getCreate2Address({
		bytecode: `0x${ScalarOutcomes_ScalarOutcomes.evm.bytecode.object}`,
		from: PROXY_DEPLOYER_ADDRESS,
		salt: ZERO_SALT,
	})

const { applyLibraries } = createApplyLinkedLibrariesHelper(() => [
	{
		hash: keccak256(toHex('contracts/ScalarOutcomes.sol:ScalarOutcomes')).slice(2, 36),
		address: getScalarOutcomesAddress(),
	},
	{
		hash: keccak256(toHex('contracts/peripherals/SecurityPoolUtils.sol:SecurityPoolUtils')).slice(2, 36),
		address: getSecurityPoolUtilsAddress(),
	},
])

export const getShareTokenFactoryByteCode = (zoltarAddress: Address) =>
	encodeDeployData({
		abi: peripherals_factories_ShareTokenFactory_ShareTokenFactory.abi,
		bytecode: `0x${peripherals_factories_ShareTokenFactory_ShareTokenFactory.evm.bytecode.object}`,
		args: [zoltarAddress],
	})

export const getEscalationGameFactoryByteCode = () =>
	encodeDeployData({
		abi: peripherals_factories_EscalationGameFactory_EscalationGameFactory.abi,
		bytecode: `0x${peripherals_factories_EscalationGameFactory_EscalationGameFactory.evm.bytecode.object}`,
	})

export const getPriceOracleManagerAndOperatorQueuerFactoryByteCode = () =>
	concatHex([
		`0x${peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object}`,
		encodeAbiParameters(
			[
				{ type: 'address' },
				{ type: 'uint256' },
				{ type: 'uint32' },
				{ type: 'uint256' },
				{ type: 'uint48' },
				{ type: 'uint24' },
				{ type: 'uint24' },
				{ type: 'uint24' },
				{ type: 'uint16' },
				{ type: 'bool' },
				{ type: 'bool' },
				{ type: 'address' },
				{ type: 'uint256' },
				{ type: 'uint256' },
				{ type: 'uint256' },
				{ type: 'uint256' },
			],
			[
				MAINNET_WETH_ADDRESS,
				ORACLE_REPORT_GAS,
				ORACLE_SETTLEMENT_GAS,
				ORACLE_EXACT_TOKEN1_REPORT,
				ORACLE_SETTLEMENT_TIME,
				ORACLE_DISPUTE_DELAY,
				ORACLE_PROTOCOL_FEE,
				ORACLE_FEE_PERCENTAGE,
				ORACLE_MULTIPLIER,
				ORACLE_TIME_TYPE,
				ORACLE_TRACK_DISPUTES,
				ORACLE_PROTOCOL_FEE_RECIPIENT,
				ORACLE_PRICE_ROUND_BUDGET_MULTIPLIER_BPS,
				ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
				ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
				ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
			],
		),
	])

export const getZoltarQuestionDataByteCode = () =>
	encodeDeployData({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		bytecode: applyLibraries(ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object),
	})

export const getSecurityPoolForkerByteCode = (zoltarAddress: Address) =>
	encodeDeployData({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		bytecode: applyLibraries(peripherals_SecurityPoolForker_SecurityPoolForker.evm.bytecode.object),
		args: [zoltarAddress],
	})

export const getZoltarInitCode = (zoltarQuestionDataAddress: Address): Hex =>
	(() => {
		return encodeDeployData({
			abi: Zoltar_Zoltar.abi,
			bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
			args: [zoltarQuestionDataAddress, DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor, DEFAULT_PROTOCOL_CONFIG.forkBurnDivisor],
		})
	})()

export const getSecurityPoolFactoryByteCode = ({
	escalationGameFactory,
	openOracle,
	priceOracleManagerAndOperatorQueuerFactory,
	securityPoolForker,
	shareTokenFactory,
	uniformPriceDualCapBatchAuctionFactory,
	zoltar,
	zoltarQuestionData,
}: {
	escalationGameFactory: Address
	openOracle: Address
	priceOracleManagerAndOperatorQueuerFactory: Address
	securityPoolForker: Address
	shareTokenFactory: Address
	uniformPriceDualCapBatchAuctionFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}) =>
	(() => {
		return encodeDeployData({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			bytecode: applyLibraries(peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
			args: [securityPoolForker, zoltarQuestionData, escalationGameFactory, openOracle, zoltar, shareTokenFactory, uniformPriceDualCapBatchAuctionFactory, priceOracleManagerAndOperatorQueuerFactory, DEFAULT_PROTOCOL_CONFIG.initialEscalationGameDeposit],
		})
	})()

const zoltarAddressHelpers = createZoltarAddressHelpers({
	getZoltarInitCode,
	proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS,
	zeroSalt: ZERO_SALT,
	zoltarQuestionDataBytecode: getZoltarQuestionDataByteCode,
})
export const { getZoltarAddress } = zoltarAddressHelpers
const { getZoltarQuestionDataAddress } = zoltarAddressHelpers

export const { getInfraContractAddresses } = createInfraContractAddressHelper({
	getEscalationGameFactoryByteCode,
	getSecurityPoolFactoryByteCode,
	getSecurityPoolForkerByteCode,
	getShareTokenFactoryByteCode,
	getZoltarAddress,
	getZoltarQuestionDataAddress,
	multicall3Bytecode: MULTICALL3_BYTECODE,
	openOracleBytecode: `0x${peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object}`,
	priceOracleManagerAndOperatorQueuerFactoryBytecode: getPriceOracleManagerAndOperatorQueuerFactoryByteCode(),
	proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS,
	scalarOutcomesBytecode: `0x${ScalarOutcomes_ScalarOutcomes.evm.bytecode.object}`,
	securityPoolUtilsBytecode: `0x${peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`,
	uniformPriceDualCapBatchAuctionFactoryBytecode: `0x${peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object}`,
	zeroSalt: ZERO_SALT,
})

export function getOpenOracleAddress() {
	return getInfraContractAddresses().openOracle
}

export function getMulticall3Address() {
	return getInfraContractAddresses().multicall3
}
