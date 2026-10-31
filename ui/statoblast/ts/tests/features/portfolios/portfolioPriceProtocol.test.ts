import { afterEach, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters, zeroHash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_TIME_TYPE } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { loadPortfolioBranchPrice, loadPortfolioPriceReport, submittedPortfolioPriceReport } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolioPrice.js'
import { sendPortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { asWriteClient, createMockWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { priceFixture, priceFeed, priceEscrow, priceOracle, priceWeth } from './priceFixture.js'
import { owner, portfolio, token, unit } from './capitalFixture.js'

afterEach(resetActiveEnvironmentForTesting)

test('direct report authentication pins stored preimages and subtracts oracle credit sentinels', async () => {
	const fixture = priceFixture()
	const snapshot = await loadPortfolioBranchPrice(fixture.client, portfolio, owner, 42n)
	fixture.reads.length = 0
	const report = await loadPortfolioPriceReport(fixture.client, snapshot, 9n)
	expect(report).toMatchObject({ reportId: 9n, escrow: priceEscrow, sponsor: owner, outcome: 0n, eligibleAt: 1_100n, wethCredit: 2n * unit, repCredit: 4n * unit })
	expect(new Set(fixture.reads.map(request => request.blockNumber))).toEqual(new Set([snapshot.blockNumber]))
	expect(fixture.reads.length).toBeLessThan(16)
	fixture.set(priceOracle, 'tokenHolder', 1n)
	expect(await loadPortfolioPriceReport(fixture.client, snapshot, 9n)).toMatchObject({ wethCredit: 0n, repCredit: 0n })
})
test.each(['escrow', 'token', 'callback', 'stored flags', 'time flag', 'state hash', 'block hash'])('report authentication rejects mismatched %s', async mismatch => {
	const fixture = priceFixture()
	const snapshot = await loadPortfolioBranchPrice(fixture.client, portfolio, owner, 42n)
	if (mismatch === 'escrow') fixture.set(priceEscrow, 'feed', token)
	if (mismatch === 'token') fixture.game.token2 = priceWeth
	if (mismatch === 'callback') fixture.game.callbackContract = token
	if (mismatch === 'stored flags') fixture.game.flags &= ~OPEN_ORACLE_FLAG_STORE_ALL
	if (mismatch === 'time flag') fixture.game.flags &= ~OPEN_ORACLE_FLAG_TIME_TYPE
	if (mismatch === 'state hash') fixture.set(priceOracle, 'oracleGame', zeroHash)
	const captured = mismatch === 'block hash' ? { ...snapshot, blockHash: `0x${'11'.repeat(32)}` satisfies Hex } : snapshot
	await expect(loadPortfolioPriceReport(fixture.client, captured, 9n)).rejects.toThrow()
})
test('receipt captures an indexed report ID while ignoring unrelated feed logs', () => {
	const abi = parseAbi(['event PriceRequested(uint256 indexed reportId,uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas)', 'event ExposureCheckpoint(uint256 indexed reportId,uint256 amount)'])
	const base = { address: priceFeed, blockHash: zeroHash, blockNumber: 10n, transactionHash: zeroHash, transactionIndex: 0n, logIndex: 0n, removed: false }
	const receipt = {
		logs: [
			{ ...base, topics: encodeEventTopics({ abi, eventName: 'ExposureCheckpoint', args: { reportId: 9n } }).filter(topic => topic !== null), data: encodeAbiParameters(parseAbiParameters('uint256'), [100n]) },
			{ ...base, logIndex: 1n, topics: encodeEventTopics({ abi, eventName: 'PriceRequested', args: { reportId: 9n } }).filter(topic => topic !== null), data: encodeAbiParameters(parseAbiParameters('uint256'), [1n]) },
		],
	}
	expect(submittedPortfolioPriceReport(receipt, priceFeed)).toBe(9n)
	expect(submittedPortfolioPriceReport(receipt, token)).toBeUndefined()
})
test('portfolio sender preserves explicit callback gas for simulation, review and sending', async () => {
	const observed: (bigint | undefined)[] = []
	const writer = asWriteClient(createMockWriteClient(request => observed.push(request.gas)))
	await sendPortfolioTransaction(
		{
			...writer,
			account: { address: owner, type: 'json-rpc' },
			chain: MAINNET_NETWORK_PROFILE.chain,
			call: async request => {
				observed.push(request.gas)
				return { data: undefined }
			},
			onTransactionPlan: requests => {
				const step = requests[0]
				const gas = step === undefined ? undefined : Reflect.get(step, 'gas')
				if (gas !== undefined && typeof gas !== 'bigint') throw new Error('Invalid review gas')
				observed.push(gas)
			},
		},
		{ account: owner, to: priceOracle, data: '0x', gas: 2_000_000n },
		'Settle report',
	)
	expect(observed).toEqual([2_000_000n, 2_000_000n, 2_000_000n])
})
