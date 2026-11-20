import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, encodeAbiParameters, parseAbi, parseAbiItem, parseAbiParameters, toEventSelector, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioDeploymentRequest, buildPortfolioPrepareNextRequest, exportPortfolioTransaction, portfolioAddressFromDeploymentLogs, validatePortfolioEconomics, type PortfolioEconomicsConfig, type PortfolioOriginConfig } from './securityPoolPortfolio.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const factory: Address = '0x0000000000000000000000000000000000000002'
const origin: PortfolioOriginConfig = { collateralToken: '0x0000000000000000000000000000000000000001', minimumReportCollateral: 10n ** 16n, universeId: 0n, securityMultiplierBps: 20_000n, reportPriorityFeeAttoEthPerGas: 10_000_000_000n }
const questionAdmissionPolicy: Address = '0x0000000000000000000000000000000000000004'
const economics: PortfolioEconomicsConfig = {
	purchaseFeeBps: 100n,
	annualFeeBps: 1_000n,
	minimumPurchaseFeeAttoEth: 10n ** 15n,
	minimumCommitmentAttoEth: 10n ** 15n,
	minimumOutcomeRate: 10n ** 9n,
	rewardVestingSeconds: 86_400n,
}
// The portfolio constructor's creator-chosen arguments, after the factory and deployer arguments the factory prepends.
const configurationInputs = parseAbiParameters(
	'(address collateralToken,uint256 minimumReportCollateral,uint248 universeId,uint256 securityMultiplierBps,uint256 reportPriorityFeeAttoEthPerGas) origin,uint256 horizon,address admission,(uint256 purchaseFeeBps,uint256 annualFeeBps,uint256 minimumPurchaseFeeAttoEth,uint256 minimumCommitmentAttoEth,uint256 minimumOutcomeRate,uint48 rewardVestingSeconds) economics',
)
const factoryAbi = parseAbi(['function deployPortfolio(bytes creationCode, bytes configuration) returns (address portfolio)'])
const creationCode = '0x1234' as const
const topic = (value: Address) => encodeAbiParameters(parseAbiParameters('address'), [value])
const base = { owner, factory, origin, questionAdmissionPolicy, maximumQuestionHorizonSeconds: 31_536_000n, economics, creationCode }

describe('shared capital portfolio deployment', () => {
	test('asks the canonical factory to deploy the pinned creation code with only the creator configuration', () => {
		const request = buildPortfolioDeploymentRequest(base)
		expect(request).toMatchObject({ account: owner, to: factory, value: 0n })
		const configuration = encodeAbiParameters(configurationInputs, [origin, base.maximumQuestionHorizonSeconds, questionAdmissionPolicy, economics])
		// The factory accepts exactly thirteen words: no deployer or factory address is the creator's to choose.
		expect(configuration.length).toBe(2 + 13 * 64)
		expect(decodeFunctionData({ abi: factoryAbi, data: request.data })).toEqual({ functionName: 'deployPortfolio', args: [creationCode, configuration] })
	})

	test('rejects creation code that is not whole hexadecimal bytes', () => {
		for (const invalid of ['0x', '0x123', '0xzz'] as const) expect(() => buildPortfolioDeploymentRequest({ ...base, creationCode: invalid })).toThrow('creation code')
	})

	test('reads the deployed portfolio only from the canonical factory deployment event', () => {
		const portfolio: Address = '0x00000000000000000000000000000000000000AA'
		const topics = [toEventSelector(parseAbiItem('event PortfolioDeployed(address indexed portfolio, address indexed creator)')), topic(portfolio), topic(owner)]
		const log = { address: factory, data: '0x' as const, topics }
		expect(portfolioAddressFromDeploymentLogs([{ address: owner, data: '0x', topics }, log], factory)).toBe(portfolio)
		expect(() => portfolioAddressFromDeploymentLogs([{ address: owner, data: '0x', topics }], factory)).toThrow('deployment event is missing')
		expect(() => portfolioAddressFromDeploymentLogs([{ ...log, topics: [topic(factory), topic(portfolio), topic(owner)] }], factory)).toThrow('deployment event is missing')
	})

	test('validates configurable fees, economic position minimums and vesting horizon', () => {
		expect(() => validatePortfolioEconomics({ ...economics, purchaseFeeBps: 0n, minimumPurchaseFeeAttoEth: 0n })).not.toThrow()
		for (const key of ['minimumCommitmentAttoEth', 'rewardVestingSeconds']) expect(() => validatePortfolioEconomics({ ...economics, [key]: 0n })).toThrow('must be positive')
		for (const rewardVestingSeconds of [1n, 86_399n]) expect(() => validatePortfolioEconomics({ ...economics, rewardVestingSeconds })).toThrow('at least 24 hours')
		for (const rewardVestingSeconds of [86_400n, 86_401n]) expect(() => validatePortfolioEconomics({ ...economics, rewardVestingSeconds })).not.toThrow()
		expect(() => validatePortfolioEconomics({ ...economics, purchaseFeeBps: 10_001n })).toThrow('100%')
		expect(() => validatePortfolioEconomics({ ...economics, annualFeeBps: 10_001n })).toThrow('100%')
		expect(() => validatePortfolioEconomics({ ...economics, annualFeeBps: 0n })).not.toThrow()
		expect(() => validatePortfolioEconomics({ ...economics, minimumOutcomeRate: 10n ** 18n + 1n })).toThrow('exchange rate')
		expect(() => validatePortfolioEconomics({ ...economics, rewardVestingSeconds: 2n ** 48n })).toThrow('uint48')
		expect(() => buildPortfolioDeploymentRequest({ ...base, maximumQuestionHorizonSeconds: 0n })).toThrow('positive')
	})

	test('validates explicit universe, security multiplier and oracle priority fee without a seed pool', () => {
		for (const universeId of [-1n, 1n << 248n]) expect(() => buildPortfolioDeploymentRequest({ ...base, origin: { ...origin, universeId } })).toThrow('Origin universe')
		for (const securityMultiplierBps of [0n, 10_000n, 10_001n, 10_499n]) expect(() => buildPortfolioDeploymentRequest({ ...base, origin: { ...origin, securityMultiplierBps } })).toThrow('10500')
		expect(() => buildPortfolioDeploymentRequest({ ...base, origin: { ...origin, securityMultiplierBps: 10_500n } })).not.toThrow()
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
