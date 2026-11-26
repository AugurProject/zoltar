import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters, zeroHash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_TIME_TYPE } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { acceptedSecurityPoolPriceReport, buildSecurityPoolPriceTokenWithdrawal, loadSecurityPoolBranchPrice, loadSecurityPoolPriceFunds, loadSecurityPoolPriceReport, submittedSecurityPoolPriceReport } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPrice.js'
import { sendSecurityPoolTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'
import { createReviewedClient } from '@zoltar/ui-statoblast-shared/protocol/reviewedClient.js'
import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { asWriteClient, createMockWriteClient, createMulticallStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { priceFixture, priceFeed, priceEscrow, priceOracle, priceWeth } from './priceFixture.js'
import { capital, owner, securityPool, token, unit } from './capitalFixture.js'

afterEach(resetActiveEnvironmentForTesting)

test('price funds find the funder’s latest operation report without a device record or global scan', async () => {
	const fixture = priceFixture()
	fixture.set(priceFeed, 'sponsorOperationReport', 9n)
	const branch = await loadSecurityPoolBranchPrice(fixture.client, securityPool, owner, 42n)
	fixture.reads.length = 0
	const client = {
		getBlock: fixture.client.getBlock,
		multicall: createMulticallStub(({ blockNumber, contracts }) => Promise.all(contracts.map(contract => fixture.client.readContract({ ...contract, blockNumber })))),
	}
	const snapshot = { ...branch, priceFeed, collateralToken: priceWeth }
	const result = await loadSecurityPoolPriceFunds(client, MAINNET_NETWORK_PROFILE, snapshot, owner)
	expect(result).toEqual([{ reportId: 9n, funder: owner }])
	expect(fixture.reads.find(request => request.functionName === 'sponsorOperationReport')?.args).toEqual([owner])
	expect(fixture.reads.some(request => request.functionName === 'nextReportId')).toBe(false)
	expect(new Set(fixture.reads.map(request => request.blockNumber))).toEqual(new Set([branch.blockNumber]))
})

test('direct report authentication pins stored preimages and subtracts oracle credit sentinels', async () => {
	const fixture = priceFixture()
	const snapshot = await loadSecurityPoolBranchPrice(fixture.client, securityPool, owner, 42n)
	fixture.reads.length = 0
	const report = await loadSecurityPoolPriceReport(fixture.client, snapshot, 9n)
	expect(report).toMatchObject({ reportId: 9n, escrow: priceEscrow, sponsor: owner, outcome: 0n, eligibleAt: 1_100n, wethCredit: 2n * unit, repCredit: 4n * unit })
	expect(new Set(fixture.reads.map(request => request.blockNumber))).toEqual(new Set([snapshot.blockNumber]))
	expect(fixture.reads.length).toBeLessThan(16)
	fixture.set(priceOracle, 'tokenHolder', 1n)
	expect(await loadSecurityPoolPriceReport(fixture.client, snapshot, 9n)).toMatchObject({ wethCredit: 0n, repCredit: 0n })
})
test('encodes independent funding withdrawals to the sponsor or a sponsor-selected recipient', async () => {
	const fixture = priceFixture()
	const snapshot = await loadSecurityPoolBranchPrice(fixture.client, securityPool, owner, 42n)
	const report = await loadSecurityPoolPriceReport(fixture.client, snapshot, 9n)
	const abi = parseAbi(['function withdrawTokenFunding(address token,address recipient)'])
	const rep = buildSecurityPoolPriceTokenWithdrawal(snapshot, report, 'rep', owner)
	const collateral = buildSecurityPoolPriceTokenWithdrawal(snapshot, report, 'collateral', securityPool)
	expect(rep).toMatchObject({ account: owner, to: priceEscrow, value: 0n })
	expect(decodeFunctionData({ abi, data: rep.data })).toEqual({ functionName: 'withdrawTokenFunding', args: [token, owner] })
	expect(decodeFunctionData({ abi, data: collateral.data })).toEqual({ functionName: 'withdrawTokenFunding', args: [priceWeth, securityPool] })
	expect(() => buildSecurityPoolPriceTokenWithdrawal({ ...snapshot, owner: securityPool }, report, 'rep', securityPool)).toThrow('Only the original funder can send funds to a different address.')
	expect(() => buildSecurityPoolPriceTokenWithdrawal(snapshot, report, 'rep', priceEscrow)).toThrow('Enter a valid recipient address other than the report funding address.')
})
test.each(['escrow', 'token', 'callback', 'stored flags', 'time flag', 'state hash', 'block hash'])('report authentication rejects mismatched %s', async mismatch => {
	const fixture = priceFixture()
	const snapshot = await loadSecurityPoolBranchPrice(fixture.client, securityPool, owner, 42n)
	if (mismatch === 'escrow') fixture.set(priceEscrow, 'feed', token)
	if (mismatch === 'token') fixture.game.token2 = priceWeth
	if (mismatch === 'callback') fixture.game.callbackContract = token
	if (mismatch === 'stored flags') fixture.game.flags &= ~OPEN_ORACLE_FLAG_STORE_ALL
	if (mismatch === 'time flag') fixture.game.flags &= ~OPEN_ORACLE_FLAG_TIME_TYPE
	if (mismatch === 'state hash') fixture.set(priceOracle, 'oracleGame', zeroHash)
	const captured = mismatch === 'block hash' ? { ...snapshot, blockHash: `0x${'11'.repeat(32)}` satisfies Hex } : snapshot
	await expect(loadSecurityPoolPriceReport(fixture.client, captured, 9n)).rejects.toThrow()
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
	expect(submittedSecurityPoolPriceReport(receipt, priceFeed)).toBe(9n)
	expect(submittedSecurityPoolPriceReport(receipt, token)).toBeUndefined()
})

test('an accepted report ID requires the verified ledger’s canonical price checkpoint in the same receipt', () => {
	const abi = parseAbi(['event CapitalPriceAccepted(uint256 price,uint48 validUntil)', 'event PriceReported(uint256 indexed reportId,uint256 price,uint256 lastSettlementTimestamp)'])
	const base = { blockHash: zeroHash, blockNumber: 10n, transactionHash: zeroHash, transactionIndex: 0n, logIndex: 0n, removed: false }
	const checkpoint = {
		...base,
		address: capital,
		topics: encodeEventTopics({ abi, eventName: 'CapitalPriceAccepted' }).filter(topic => topic !== null),
		data: encodeAbiParameters(parseAbiParameters('uint256,uint48'), [unit, 1_700]),
	}
	const reported = {
		...base,
		address: priceFeed,
		logIndex: 1n,
		topics: encodeEventTopics({ abi, eventName: 'PriceReported', args: { reportId: 9n } }).filter(topic => topic !== null),
		data: encodeAbiParameters(parseAbiParameters('uint256,uint256'), [unit, 1_100n]),
	}
	expect(acceptedSecurityPoolPriceReport({ logs: [checkpoint, reported] }, priceFeed, capital, 600n)).toEqual({ reportId: 9n, price: unit, observedAt: 1_100n })
	expect(acceptedSecurityPoolPriceReport({ logs: [reported] }, priceFeed, capital, 600n)).toBeUndefined()
	expect(acceptedSecurityPoolPriceReport({ logs: [{ ...checkpoint, address: token }, reported] }, priceFeed, capital, 600n)).toBeUndefined()
	expect(acceptedSecurityPoolPriceReport({ logs: [checkpoint, reported] }, token, capital, 600n)).toBeUndefined()
	expect(acceptedSecurityPoolPriceReport({ logs: [checkpoint, reported] }, priceFeed, capital, 599n)).toBeUndefined()
})
test('security pool sender preserves explicit callback gas for simulation, review and sending', async () => {
	const observed: (bigint | undefined)[] = []
	const writer = asWriteClient(createMockWriteClient(request => observed.push(request.gas)))
	await sendSecurityPoolTransaction(
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

test('Capital review allows successive slow validation and simulation requests', async () => {
	const requests: Hex[] = []
	const writer = asWriteClient(
		createMockWriteClient(request => {
			if (request.data !== undefined) requests.push(request.data)
		}),
	)
	const shortened = new Proxy(globalThis.setTimeout, {
		apply(schedule, receiver, [handler, delay, ...args]) {
			return Reflect.apply(schedule, receiver, [handler, delay === 15_000 ? 40 : delay, ...args])
		},
	})
	const timer = spyOn(globalThis, 'setTimeout').mockImplementation(shortened)
	try {
		const client = {
			...writer,
			account: { address: owner, type: 'json-rpc' },
			chain: MAINNET_NETWORK_PROFILE.chain,
			call: async () => {
				await Bun.sleep(25)
				return { data: undefined }
			},
		}
		await sendSecurityPoolTransaction(client, { account: owner, to: priceOracle, data: '0x' }, 'Review', async () => {
			await Bun.sleep(25)
		})
		expect(requests).toEqual(['0x'])
	} finally {
		timer.mockRestore()
	}
})

test('Capital opens review while its preflight is still reading', async () => {
	const abort = new AbortController()
	const reading = createDeferred<void>()
	const sent = mock(() => undefined)
	const call = mock(async () => ({ data: undefined }))
	const client = createReviewedClient({ ...asWriteClient(createMockWriteClient(sent)), account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call }, undefined, abort.signal, undefined, true)
	const sending = sendSecurityPoolTransaction(client, { account: owner, to: priceOracle, data: '0x', validateBeforeSubmit: () => reading.promise }, 'Claim earnings')
	const settled = sending.catch(() => undefined)
	try {
		await waitFor(() => expect(transactionSteps.value?.reviewCheck?.status).toBe('checking'), { timeout: 300 })
		expect(call).not.toHaveBeenCalled()
		expect(sent).not.toHaveBeenCalled()
		reading.resolve()
		await waitFor(() => expect(transactionSteps.value?.reviewCheck).toBeUndefined())
		expect(call).toHaveBeenCalledTimes(1)
		transactionSteps.value?.confirmStep(0)
		await sending
		expect(sent).toHaveBeenCalledTimes(1)
	} finally {
		abort.abort()
		reading.resolve()
		await settled
	}
})

test('#1252 the UI security pool adapter preserves the base fee for bounty quotes', async () => {
	const fixture = priceFixture()
	fixture.setBaseFee(7n)
	const snapshot = await loadSecurityPoolBranchPrice(fixture.client, securityPool, owner, 42n)
	expect(snapshot.observation?.bounty).toBe(15_804_573n * (10_000_000_000n + 7n) + 101n)
})

test('#1650 direct escrow tokens remain withdrawable with only oracle sentinels', async () => {
	const fixture = priceFixture()
	const snapshot = await loadSecurityPoolBranchPrice(fixture.client, securityPool, owner, 42n)
	fixture.set(priceOracle, 'tokenHolder', 1n)
	fixture.set(priceWeth, 'balanceOf', 7n)
	fixture.set(token, 'balanceOf', 9n)
	const report = await loadSecurityPoolPriceReport(fixture.client, snapshot, 9n)
	expect(report).toMatchObject({ wethCredit: 7n, repCredit: 9n })
	expect(buildSecurityPoolPriceTokenWithdrawal(snapshot, report, 'rep', owner).to).toBe(priceEscrow)
})
