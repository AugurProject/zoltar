import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, encodeAbiParameters, parseAbi, parseAbiParameters, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioDeploymentRequest, buildPortfolioPrepareNextRequest, exportPortfolioTransaction, validatePortfolioEconomics, type PortfolioEconomicsConfig, type PortfolioOriginConfig } from './securityPoolPortfolio.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const factory: Address = '0x0000000000000000000000000000000000000002'
const origin: PortfolioOriginConfig = { collateralToken: '0x0000000000000000000000000000000000000001', minimumReportCollateral: 10n ** 16n, universeId: 0n, securityMultiplierBps: 20_000n, reportPriorityFeeAttoEthPerGas: 10_000_000_000n }
const questionAdmissionPolicy: Address = '0x0000000000000000000000000000000000000004'
const deployers = { capital: factory, commitments: factory, fees: factory, books: factory, settlement: factory, reporters: factory, forks: factory, services: factory, auctions: factory }
const economics: PortfolioEconomicsConfig = {
	purchaseFeeBps: 100n,
	annualFeeBps: 1_000n,
	minimumPurchaseFeeAttoEth: 10n ** 15n,
	minimumCommitmentAttoEth: 10n ** 15n,
	minimumOutcomeRate: 10n ** 9n,
	rewardVestingSeconds: 86_400n,
}
const inputs = parseAbiParameters(
	'address factory,(address collateralToken,uint256 minimumReportCollateral,uint248 universeId,uint256 securityMultiplierBps,uint256 reportPriorityFeeAttoEthPerGas) origin,uint256 horizon,(address capital,address commitments,address fees,address books,address settlement,address reporters,address forks,address services,address auctions) deployment,address admission,(uint256 purchaseFeeBps,uint256 annualFeeBps,uint256 minimumPurchaseFeeAttoEth,uint256 minimumCommitmentAttoEth,uint256 minimumOutcomeRate,uint48 rewardVestingSeconds) config',
)
const abi = [{ type: 'constructor', stateMutability: 'nonpayable', inputs }] as const
const base = { owner, factory, origin, questionAdmissionPolicy, maximumQuestionHorizonSeconds: 31_536_000n, deployers, economics, artifact: { abi, bytecode: '0x1234' as const } }

describe('shared capital portfolio deployment', () => {
	test('encodes module deployment addresses and pool economics without a shared owner health target', () => {
		const request = buildPortfolioDeploymentRequest(base)
		const constructor = abi.find(entry => entry.type === 'constructor')
		if (constructor === undefined || constructor.type !== 'constructor') throw new Error('Missing test constructor')
		const encoded = encodeAbiParameters(constructor.inputs, [factory, origin, base.maximumQuestionHorizonSeconds, deployers, questionAdmissionPolicy, economics])
		expect(request).toEqual({ account: owner, data: `0x1234${encoded.slice(2)}` })
	})

	test('validates configurable fees, economic position minimums, vesting horizon and module addresses', () => {
		expect(() => validatePortfolioEconomics({ ...economics, purchaseFeeBps: 0n, minimumPurchaseFeeAttoEth: 0n })).not.toThrow()
		for (const key of ['minimumCommitmentAttoEth', 'rewardVestingSeconds']) expect(() => validatePortfolioEconomics({ ...economics, [key]: 0n })).toThrow('must be positive')
		expect(() => validatePortfolioEconomics({ ...economics, purchaseFeeBps: 10_001n })).toThrow('100%')
		expect(() => validatePortfolioEconomics({ ...economics, annualFeeBps: 10_001n })).toThrow('100%')
		expect(() => validatePortfolioEconomics({ ...economics, annualFeeBps: 0n })).not.toThrow()
		expect(() => buildPortfolioDeploymentRequest({ ...base, deployers: { ...deployers, auctions: zeroAddress } })).toThrow('auctions deployer')
		expect(() => validatePortfolioEconomics({ ...economics, minimumOutcomeRate: 10n ** 18n + 1n })).toThrow('exchange rate')
		expect(() => validatePortfolioEconomics({ ...economics, rewardVestingSeconds: 2n ** 48n })).toThrow('uint48')
		expect(() => buildPortfolioDeploymentRequest({ ...base, deployers: { ...deployers, commitments: zeroAddress } })).toThrow('commitments deployer')
		expect(() => buildPortfolioDeploymentRequest({ ...base, maximumQuestionHorizonSeconds: 0n })).toThrow('positive')
	})

	test('validates explicit universe, security multiplier and oracle priority fee without a seed pool', () => {
		for (const universeId of [-1n, 1n << 248n]) expect(() => buildPortfolioDeploymentRequest({ ...base, origin: { ...origin, universeId } })).toThrow('Origin universe')
		for (const securityMultiplierBps of [0n, 10_000n, 10_001n]) expect(() => buildPortfolioDeploymentRequest({ ...base, origin: { ...origin, securityMultiplierBps } })).toThrow('10001')
		expect(() => buildPortfolioDeploymentRequest({ ...base, origin: { ...origin, reportPriorityFeeAttoEthPerGas: 0n } })).toThrow('positive')
	})

	test('exports exact unsigned smart-account transactions and rejects malformed values', () => {
		const request = { account: owner, to: factory, data: '0xabcd' as const, value: 12n }
		expect(exportPortfolioTransaction({ chainId: 1, request })).toEqual({ chainId: 1, from: owner, to: factory, data: '0xabcd', value: '12' })
		expect(() => exportPortfolioTransaction({ chainId: 0, request })).toThrow('chain id')
		expect(() => exportPortfolioTransaction({ chainId: 1, request: { ...request, data: '0xabc' } })).toThrow('whole hexadecimal bytes')
	})

	test('setup resumes one fixed stage without granting callers configuration or asset authority', () => {
		const request = buildPortfolioPrepareNextRequest({ caller: owner, portfolio: factory })
		expect(request).toMatchObject({ account: owner, to: factory, value: 0n })
		expect(decodeFunctionData({ abi: parseAbi(['function prepareNext()']), data: request.data })).toEqual({ functionName: 'prepareNext', args: [] })
		expect(() => buildPortfolioPrepareNextRequest({ caller: owner, portfolio: zeroAddress })).toThrow('Portfolio')
	})
})

test('deployment rejects missing collateral and a zero or oversized report stake floor', () => {
	expect(() => buildPortfolioDeploymentRequest({ ...base, origin: { ...origin, collateralToken: zeroAddress } })).toThrow('Collateral token')
	for (const minimumReportCollateral of [0n, 1n << 128n]) expect(() => buildPortfolioDeploymentRequest({ ...base, origin: { ...origin, minimumReportCollateral } })).toThrow()
})
