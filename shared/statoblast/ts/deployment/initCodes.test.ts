import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, getCreate2Address, keccak256, parseAbiParameters, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { createStatoblastInitCodes } from './initCodes.js'

const proxy: Address = '0x0000000000000000000000000000000000000001'
const zoltar: Address = '0x0000000000000000000000000000000000000002'
const questionData: Address = '0x0000000000000000000000000000000000000003'
const weth: Address = '0x0000000000000000000000000000000000000004'
const zeroSalt: Hex = `0x${'00'.repeat(32)}`
const artifact = (id: number, inputs = '') => ({ abi: [{ type: 'constructor' as const, stateMutability: 'nonpayable' as const, inputs: parseAbiParameters(inputs) }], evm: { bytecode: { object: `60${id.toString(16).padStart(2, '0')}6000` } } })
const artifacts = {
	escalationGameDepositDelegate: artifact(2),
	escalationGameFactory: artifact(3, 'address'),
	multicall3: artifact(4),
	openOracle: artifact(5),
	openOraclePriceCoordinatorFactory: artifact(6),
	priceCoordinatorDeploymentWorker: artifact(7),
	sharedPoolPriceFeedDeploymentWorker: artifact(8),
	securityPoolFactory: artifact(9, 'address,address,address,address,address,address,address,address,address,bytes32,address[9]'),
	securityPoolPortfolio: artifact(26),
	questionForker: artifact(10, 'address,address'),
	questionForkerDelegate: artifact(11, 'address'),
	questionLedgerOperationsDelegate: artifact(12),
	questionLedgerEventEmitter: artifact(13),
	shareTokenFactory: artifact(15, 'address'),
	securityPoolCapitalLedgerDeployer: artifact(17),
	securityPoolCommitmentIndexDeployer: artifact(18),
	securityPoolCapitalFeeStreamsDeployer: artifact(19),
	securityPoolSettlementBookDeployer: artifact(20),
	securityPoolPortfolioSettlementDeployer: artifact(21),
	securityPoolPortfolioServicesDeployer: artifact(23),
	securityPoolReporterLedgerDeployer: artifact(22),
	securityPoolPortfolioForkCoordinatorDeployer: artifact(24),
	securityPoolPortfolioAuctionDeployer: artifact(25),
}
const builders = createStatoblastInitCodes(artifacts, { proxyDeployerAddress: proxy, zeroSalt })
const constructorArgs = (code: Hex) => `0x${code.slice(10)}` as const

describe('shared capital infrastructure init codes', () => {
	test('native fork delegation binds the same protocol and deterministic module address', () => {
		const delegateCode = builders.getQuestionForkerDelegateByteCode(zoltar)
		const delegate = getCreate2Address({ bytecode: delegateCode, from: proxy, salt: zeroSalt })
		expect(constructorArgs(delegateCode)).toBe(encodeAbiParameters(parseAbiParameters('address'), [zoltar]))
		expect(constructorArgs(builders.getQuestionForkerByteCode(zoltar))).toBe(encodeAbiParameters(parseAbiParameters('address,address'), [zoltar, delegate]))
		const addresses = builders.createInfraContractAddresses(weth, { getZoltarAddress: () => zoltar, getZoltarQuestionDataAddress: () => questionData })()
		expect(addresses.questionForkerDelegate).toBe(delegate)
	})

	test('fork and auction deployers need no constructor parameters and all module addresses are distinct', () => {
		const addresses = builders.createInfraContractAddresses(weth, { getZoltarAddress: () => zoltar, getZoltarQuestionDataAddress: () => questionData })()
		const modules = [
			addresses.securityPoolCapitalLedgerDeployer,
			addresses.securityPoolCommitmentIndexDeployer,
			addresses.securityPoolCapitalFeeStreamsDeployer,
			addresses.securityPoolSettlementBookDeployer,
			addresses.securityPoolPortfolioSettlementDeployer,
			addresses.securityPoolPortfolioServicesDeployer,
			addresses.securityPoolReporterLedgerDeployer,
			addresses.securityPoolPortfolioForkCoordinatorDeployer,
			addresses.securityPoolPortfolioAuctionDeployer,
		]
		expect(constructorArgs(builders.getSecurityPoolPortfolioForkCoordinatorDeployerByteCode())).toBe('0x')
		expect(constructorArgs(builders.getSecurityPoolPortfolioAuctionDeployerByteCode())).toBe('0x')
		expect(new Set(modules).size).toBe(9)
		expect(addresses.securityPoolPortfolioAuctionDeployer).toBe(getCreate2Address({ bytecode: builders.getSecurityPoolPortfolioAuctionDeployerByteCode(), from: proxy, salt: zeroSalt }))
	})

	test('the factory pins the portfolio creation code hash and the module deployers in portfolio constructor order', () => {
		const addresses = builders.createInfraContractAddresses(weth, { getZoltarAddress: () => zoltar, getZoltarQuestionDataAddress: () => questionData })()
		const factoryCode = builders.getSecurityPoolFactoryByteCode(addresses)
		const deployers = [
			addresses.securityPoolCapitalLedgerDeployer,
			addresses.securityPoolCommitmentIndexDeployer,
			addresses.securityPoolCapitalFeeStreamsDeployer,
			addresses.securityPoolSettlementBookDeployer,
			addresses.securityPoolPortfolioSettlementDeployer,
			addresses.securityPoolReporterLedgerDeployer,
			addresses.securityPoolPortfolioForkCoordinatorDeployer,
			addresses.securityPoolPortfolioServicesDeployer,
			addresses.securityPoolPortfolioAuctionDeployer,
		] as const
		expect(constructorArgs(factoryCode)).toBe(
			encodeAbiParameters(parseAbiParameters('address,address,address,address,address,address,address,address,address,bytes32,address[9]'), [
				addresses.questionForker,
				addresses.zoltarQuestionData,
				addresses.escalationGameFactory,
				addresses.openOracle,
				addresses.zoltar,
				addresses.shareTokenFactory,
				addresses.openOraclePriceCoordinatorFactory,
				addresses.questionLedgerOperationsDelegate,
				addresses.questionLedgerEventEmitter,
				keccak256(builders.getSecurityPoolPortfolioCreationCode()),
				deployers,
			]),
		)
		expect(addresses.securityPoolFactory).toBe(getCreate2Address({ bytecode: factoryCode, from: proxy, salt: zeroSalt }))
	})
})
