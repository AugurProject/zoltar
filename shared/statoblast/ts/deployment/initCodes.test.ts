import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, getCreate2Address, parseAbiParameters, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { createStatoblastInitCodes } from './initCodes.js'

const proxy: Address = '0x0000000000000000000000000000000000000001'
const zoltar: Address = '0x0000000000000000000000000000000000000002'
const questionData: Address = '0x0000000000000000000000000000000000000003'
const weth: Address = '0x0000000000000000000000000000000000000004'
const zeroSalt: Hex = `0x${'00'.repeat(32)}`
const artifact = (id: number, inputs = '') => ({ abi: [{ type: 'constructor' as const, stateMutability: 'nonpayable' as const, inputs: parseAbiParameters(inputs) }], evm: { bytecode: { object: `60${id.toString(16).padStart(2, '0')}6000` } } })
const artifacts = {
	escalationGameClaimDelegate: artifact(1),
	escalationGameDepositDelegate: artifact(2),
	escalationGameFactory: artifact(3, 'address,address'),
	multicall3: artifact(4),
	openOracle: artifact(5),
	openOraclePriceCoordinatorFactory: artifact(6),
	priceCoordinatorDeploymentWorker: artifact(7),
	sharedPoolPriceFeedDeploymentWorker: artifact(8),
	securityPoolFactory: artifact(9, 'address,address,address,address,address,address,address,address,uint256,uint256,address,address'),
	securityPoolForker: artifact(10, 'address,address'),
	securityPoolForkerPortfolioDelegate: artifact(11, 'address'),
	securityPoolOperationsDelegate: artifact(12),
	securityPoolEventEmitter: artifact(13),
	securityPoolUtils: artifact(14),
	shareTokenFactory: artifact(15, 'address'),
	uniformPriceDualCapBatchAuctionFactory: artifact(16),
	securityPoolCapitalLedgerDeployer: artifact(17),
	securityPoolCommitmentIndexDeployer: artifact(18),
	securityPoolCapitalFeeStreamsDeployer: artifact(19),
	securityPoolSettlementBookDeployer: artifact(20),
	securityPoolPortfolioSettlementDeployer: artifact(21),
	securityPoolPortfolioServicesDeployer: artifact(23),
	securityPoolReporterLedgerDeployer: artifact(22),
	securityPoolPortfolioForkCoordinatorDeployer: artifact(24, 'address'),
}
const builders = createStatoblastInitCodes(artifacts, { proxyDeployerAddress: proxy, zeroSalt })
const constructorArgs = (code: Hex) => `0x${code.slice(10)}` as const

describe('shared capital infrastructure init codes', () => {
	test('native fork delegation binds the same protocol and deterministic module address', () => {
		const delegateCode = builders.getSecurityPoolForkerPortfolioDelegateByteCode(zoltar)
		const delegate = getCreate2Address({ bytecode: delegateCode, from: proxy, salt: zeroSalt })
		expect(constructorArgs(delegateCode)).toBe(encodeAbiParameters(parseAbiParameters('address'), [zoltar]))
		expect(constructorArgs(builders.getSecurityPoolForkerByteCode(zoltar))).toBe(encodeAbiParameters(parseAbiParameters('address,address'), [zoltar, delegate]))
		const addresses = builders.createInfraContractAddresses(weth, { getZoltarAddress: () => zoltar, getZoltarQuestionDataAddress: () => questionData })()
		expect(addresses.securityPoolForkerPortfolioDelegate).toBe(delegate)
	})

	test('the fork factory needs no auction and all capital module addresses are distinct', () => {
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
		]
		expect(constructorArgs(builders.getSecurityPoolPortfolioForkCoordinatorDeployerByteCode())).toBe('0x')
		expect(new Set(modules).size).toBe(8)
	})
})
