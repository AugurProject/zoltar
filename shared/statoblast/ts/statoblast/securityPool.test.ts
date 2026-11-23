import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, encodeAbiParameters, parseAbi, parseAbiItem, parseAbiParameters, toEventSelector, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildSecurityPoolDeploymentRequest, buildSecurityPoolPrepareNextRequest, exportSecurityPoolTransaction, securityPoolAddressFromDeploymentLogs, validateSecurityPoolEconomics, type SecurityPoolEconomicsConfig, type SecurityPoolOriginConfig } from './securityPool.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const factory: Address = '0x0000000000000000000000000000000000000002'
const origin: SecurityPoolOriginConfig = { collateralToken: '0x0000000000000000000000000000000000000001', minimumReportCollateral: 10n ** 16n, universeId: 0n, securityMultiplierBps: 20_000n, reportPriorityFeeAttoEthPerGas: 10_000_000_000n }
const questionAdmissionPolicy: Address = '0x0000000000000000000000000000000000000004'
const economics: SecurityPoolEconomicsConfig = {
	purchaseFeeBps: 100n,
	annualFeeBps: 1_000n,
	minimumPurchaseFeeAttoEth: 10n ** 15n,
	minimumCommitmentAttoEth: 10n ** 15n,
	minimumOutcomeRate: 10n ** 9n,
	rewardVestingSeconds: 86_400n,
}
// The security pool constructor's creator-chosen arguments, after the factory and deployer arguments the factory prepends.
const configurationInputs = parseAbiParameters(
	'(address collateralToken,uint256 minimumReportCollateral,uint248 universeId,uint256 securityMultiplierBps,uint256 reportPriorityFeeAttoEthPerGas) origin,uint256 horizon,address admission,(uint256 purchaseFeeBps,uint256 annualFeeBps,uint256 minimumPurchaseFeeAttoEth,uint256 minimumCommitmentAttoEth,uint256 minimumOutcomeRate,uint48 rewardVestingSeconds) economics',
)
const factoryAbi = parseAbi(['function deploySecurityPool(bytes creationCode, bytes configuration) returns (address securityPool)'])
const creationCode = '0x1234' as const
const topic = (value: Address) => encodeAbiParameters(parseAbiParameters('address'), [value])
const base = { owner, factory, origin, questionAdmissionPolicy, maximumQuestionHorizonSeconds: 31_536_000n, economics, creationCode }

describe('shared capital security pool deployment', () => {
	test('asks the canonical factory to deploy the pinned creation code with only the creator configuration', () => {
		const request = buildSecurityPoolDeploymentRequest(base)
		expect(request).toMatchObject({ account: owner, to: factory, value: 0n })
		const configuration = encodeAbiParameters(configurationInputs, [origin, base.maximumQuestionHorizonSeconds, questionAdmissionPolicy, economics])
		// The factory accepts exactly thirteen words: no deployer or factory address is the creator's to choose.
		expect(configuration.length).toBe(2 + 13 * 64)
		expect(decodeFunctionData({ abi: factoryAbi, data: request.data })).toEqual({ functionName: 'deploySecurityPool', args: [creationCode, configuration] })
	})

	test('rejects creation code that is not whole hexadecimal bytes', () => {
		for (const invalid of ['0x', '0x123', '0xzz'] as const) expect(() => buildSecurityPoolDeploymentRequest({ ...base, creationCode: invalid })).toThrow('creation code')
	})

	test('reads the deployed security pool only from the canonical factory deployment event', () => {
		const securityPool: Address = '0x00000000000000000000000000000000000000AA'
		const topics = [toEventSelector(parseAbiItem('event SecurityPoolDeployed(address indexed securityPool, address indexed creator)')), topic(securityPool), topic(owner)]
		const log = { address: factory, data: '0x' as const, topics }
		expect(securityPoolAddressFromDeploymentLogs([{ address: owner, data: '0x', topics }, log], factory)).toBe(securityPool)
		expect(() => securityPoolAddressFromDeploymentLogs([{ address: owner, data: '0x', topics }], factory)).toThrow('deployment event is missing')
		expect(() => securityPoolAddressFromDeploymentLogs([{ ...log, topics: [topic(factory), topic(securityPool), topic(owner)] }], factory)).toThrow('deployment event is missing')
	})

	test('validates configurable fees, economic position minimums and vesting horizon', () => {
		expect(() => validateSecurityPoolEconomics({ ...economics, purchaseFeeBps: 0n, minimumPurchaseFeeAttoEth: 0n })).not.toThrow()
		for (const key of ['minimumCommitmentAttoEth', 'rewardVestingSeconds']) expect(() => validateSecurityPoolEconomics({ ...economics, [key]: 0n })).toThrow('must be positive')
		for (const rewardVestingSeconds of [1n, 86_399n]) expect(() => validateSecurityPoolEconomics({ ...economics, rewardVestingSeconds })).toThrow('at least 24 hours')
		for (const rewardVestingSeconds of [86_400n, 86_401n]) expect(() => validateSecurityPoolEconomics({ ...economics, rewardVestingSeconds })).not.toThrow()
		expect(() => validateSecurityPoolEconomics({ ...economics, rewardVestingSeconds: 3650n * 86_400n })).not.toThrow()
		expect(() => validateSecurityPoolEconomics({ ...economics, rewardVestingSeconds: 3650n * 86_400n + 1n })).toThrow('3650 days')
		expect(() => validateSecurityPoolEconomics({ ...economics, purchaseFeeBps: 10_001n })).toThrow('100%')
		expect(() => validateSecurityPoolEconomics({ ...economics, annualFeeBps: 10_001n })).toThrow('100%')
		expect(() => validateSecurityPoolEconomics({ ...economics, annualFeeBps: 0n })).not.toThrow()
		expect(() => validateSecurityPoolEconomics({ ...economics, minimumOutcomeRate: 10n ** 18n + 1n })).toThrow('exchange rate')
		expect(() => validateSecurityPoolEconomics({ ...economics, rewardVestingSeconds: 2n ** 48n })).toThrow('uint48')
		expect(() => buildSecurityPoolDeploymentRequest({ ...base, maximumQuestionHorizonSeconds: 0n })).toThrow('positive')
	})

	test('validates explicit universe, security multiplier and oracle priority fee without a seed pool', () => {
		for (const universeId of [-1n, 1n << 248n]) expect(() => buildSecurityPoolDeploymentRequest({ ...base, origin: { ...origin, universeId } })).toThrow('Origin universe')
		for (const securityMultiplierBps of [0n, 10_000n, 10_001n, 10_499n]) expect(() => buildSecurityPoolDeploymentRequest({ ...base, origin: { ...origin, securityMultiplierBps } })).toThrow('10500')
		expect(() => buildSecurityPoolDeploymentRequest({ ...base, origin: { ...origin, securityMultiplierBps: 10_500n } })).not.toThrow()
		expect(() => buildSecurityPoolDeploymentRequest({ ...base, origin: { ...origin, reportPriorityFeeAttoEthPerGas: 0n } })).toThrow('positive')
	})

	test('exports exact unsigned smart-account transactions and rejects malformed values', () => {
		const request = { account: owner, to: factory, data: '0xabcd' as const, value: 12n }
		expect(exportSecurityPoolTransaction({ chainId: 1, request })).toEqual({ chainId: 1, from: owner, to: factory, data: '0xabcd', value: '12' })
		expect(() => exportSecurityPoolTransaction({ chainId: 0, request })).toThrow('chain id')
		expect(() => exportSecurityPoolTransaction({ chainId: 1, request: { ...request, data: '0xabc' } })).toThrow('whole hexadecimal bytes')
	})

	test('setup resumes one fixed stage without granting callers configuration or asset authority', () => {
		const request = buildSecurityPoolPrepareNextRequest({ caller: owner, securityPool: factory })
		expect(request).toMatchObject({ account: owner, to: factory, value: 0n })
		expect(decodeFunctionData({ abi: parseAbi(['function prepareNext()']), data: request.data })).toEqual({ functionName: 'prepareNext', args: [] })
		expect(() => buildSecurityPoolPrepareNextRequest({ caller: owner, securityPool: zeroAddress })).toThrow('Security pool')
	})
})

test('deployment rejects missing collateral and a zero or oversized report stake floor', () => {
	expect(() => buildSecurityPoolDeploymentRequest({ ...base, origin: { ...origin, collateralToken: zeroAddress } })).toThrow('Collateral token')
	for (const minimumReportCollateral of [0n, 1n << 128n]) expect(() => buildSecurityPoolDeploymentRequest({ ...base, origin: { ...origin, minimumReportCollateral } })).toThrow()
})
