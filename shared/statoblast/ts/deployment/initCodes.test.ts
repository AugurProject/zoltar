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
	sharedPoolPriceFeedFactory: artifact(6),
	sharedPoolPriceFeedDeploymentWorker: artifact(8),
	securityPoolFactory: artifact(9, 'address,address,address,address,address,address,address,address,bytes32,address[9]'),
	securityPool: artifact(26),
	questionForker: artifact(10, 'address'),
	questionLedgerDelegate: artifact(12),
	shareTokenFactory: artifact(15, 'address'),
	securityPoolCapitalLedgerDeployer: artifact(17),
	securityPoolCommitmentIndexDeployer: artifact(18),
	securityPoolCapitalFeeStreamsDeployer: artifact(19),
	securityPoolSettlementBookDeployer: artifact(20),
	securityPoolSettlementDeployer: artifact(21),
	securityPoolServicesDeployer: artifact(23),
	securityPoolReporterLedgerDeployer: artifact(22),
	securityPoolForkCoordinatorDeployer: artifact(24),
	securityPoolRepairAuctionDeployer: artifact(25),
}
const builders = createStatoblastInitCodes(artifacts, { proxyDeployerAddress: proxy, zeroSalt })
const constructorArgs = (code: Hex) => `0x${code.slice(10)}` as const

describe('shared capital infrastructure init codes', () => {
	test('the combined native forker binds the protocol directly', () => {
		const code = builders.getQuestionForkerByteCode(zoltar)
		expect(constructorArgs(code)).toBe(encodeAbiParameters(parseAbiParameters('address'), [zoltar]))
		const addresses = builders.createInfraContractAddresses(weth, { getZoltarAddress: () => zoltar, getZoltarQuestionDataAddress: () => questionData })()
		expect(addresses.questionForker).toBe(getCreate2Address({ bytecode: code, from: proxy, salt: zeroSalt }))
	})

	test('fork and auction deployers need no constructor parameters and all module addresses are distinct', () => {
		const addresses = builders.createInfraContractAddresses(weth, { getZoltarAddress: () => zoltar, getZoltarQuestionDataAddress: () => questionData })()
		const modules = [
			addresses.securityPoolCapitalLedgerDeployer,
			addresses.securityPoolCommitmentIndexDeployer,
			addresses.securityPoolCapitalFeeStreamsDeployer,
			addresses.securityPoolSettlementBookDeployer,
			addresses.securityPoolSettlementDeployer,
			addresses.securityPoolServicesDeployer,
			addresses.securityPoolReporterLedgerDeployer,
			addresses.securityPoolForkCoordinatorDeployer,
			addresses.securityPoolRepairAuctionDeployer,
		]
		expect(constructorArgs(builders.getSecurityPoolForkCoordinatorDeployerByteCode())).toBe('0x')
		expect(constructorArgs(builders.getSecurityPoolRepairAuctionDeployerByteCode())).toBe('0x')
		expect(new Set(modules).size).toBe(9)
		expect(addresses.securityPoolRepairAuctionDeployer).toBe(getCreate2Address({ bytecode: builders.getSecurityPoolRepairAuctionDeployerByteCode(), from: proxy, salt: zeroSalt }))
	})

	test('the factory pins the security pool creation code hash and the module deployers in security pool constructor order', () => {
		const addresses = builders.createInfraContractAddresses(weth, { getZoltarAddress: () => zoltar, getZoltarQuestionDataAddress: () => questionData })()
		const factoryCode = builders.getSecurityPoolFactoryByteCode(addresses)
		const deployers = [
			addresses.securityPoolCapitalLedgerDeployer,
			addresses.securityPoolCommitmentIndexDeployer,
			addresses.securityPoolCapitalFeeStreamsDeployer,
			addresses.securityPoolSettlementBookDeployer,
			addresses.securityPoolSettlementDeployer,
			addresses.securityPoolReporterLedgerDeployer,
			addresses.securityPoolForkCoordinatorDeployer,
			addresses.securityPoolServicesDeployer,
			addresses.securityPoolRepairAuctionDeployer,
		] as const
		expect(constructorArgs(factoryCode)).toBe(
			encodeAbiParameters(parseAbiParameters('address,address,address,address,address,address,address,address,address,bytes32,address[9]'), [
				addresses.questionForker,
				addresses.zoltarQuestionData,
				addresses.escalationGameFactory,
				addresses.openOracle,
				addresses.zoltar,
				addresses.shareTokenFactory,
				addresses.sharedPoolPriceFeedFactory,
				addresses.questionLedgerDelegate,
				keccak256(builders.getSecurityPoolCreationCode()),
				deployers,
			]),
		)
		expect(addresses.securityPoolFactory).toBe(getCreate2Address({ bytecode: factoryCode, from: proxy, salt: zeroSalt }))
	})
})
