import { formatOpenOracleReportPriceUnit, getOpenOracleDisputeAvailability } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/openOracle.js'
import { getGenesisReputationTokenAddress } from '@zoltar/ui-zoltar-shared/protocol/activeProtocolAddresses.js'
import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createWalletClient, custom, publicActions, encodeAbiParameters, encodeEventTopics, parseAbiParameters, decodeFunctionData, parseAbi, getAddress, toHex, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getOpenOracleGameTuple, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_TRACK_DISPUTES, OPEN_ORACLE_FLAG_TIME_TYPE, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { createOpenOracleReportInstance, disputeOracleReport, getOpenOracleSettleGasLimit, loadOpenOracleReportDetails, loadOpenOracleWithdrawableBalances, loadOpenOracleReportSummaries, settleOracleReport, withdrawOpenOracleBalance } from '@zoltar/ui-statoblast-shared/protocol/openOracle.js'
import { getOracleManagerPriceValidUntilTimestamp } from '@zoltar/ui-statoblast-shared/protocol/oracleTiming.js'
import { getInfraContractAddresses, getOpenOracleAddress } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { loadCoordinatorPriceValidUntilTimestamp } from '@zoltar/ui-statoblast-shared/protocol/openOracleSettlement.js'
import { statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed, statoblast_openOracle_OpenOracle_OpenOracle } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { asWriteClient, createMulticallStub, createBlockWithTimestamp, createMockLoaderClient, createMockWriteClient, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { createReviewedClient } from '@zoltar/ui-statoblast-shared/protocol/reviewedClient.js'
import { formatReportBrowseTitle } from '@zoltar/ui-statoblast-shared/copy/openOracle.js'
import { getOpenOracleDisputeSwapTokenKey } from '@zoltar/ui-statoblast-shared/protocol/openOracleMath.js'

const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
const alternateSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
const token1Address = getAddress('0x00000000000000000000000000000000000000d1')
const token2Address = getAddress('0x00000000000000000000000000000000000000d2')
const wethAddress = getAddress(SEPOLIA_NETWORK_PROFILE.wethAddress)
const initialReporter = getAddress('0x00000000000000000000000000000000000000e1')

function createOpenOraclePreimage(reportId = 1n): OpenOracleStatePreimage {
	return {
		game: {
			callbackContract: zeroAddress,
			callbackGasLimit: 0n,
			currentAmount1: 100n,
			currentAmount2: 10n,
			currentReporter: initialReporter,
			disputeDelay: 0n,
			escalationHalt: 0n,
			feePercentage: 0n,
			flags: OPEN_ORACLE_FLAG_TIME_TYPE | OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES,
			lastReportOppoTime: 1n,
			multiplier: 100n,
			numReports: 1n,
			protocolFee: 0n,
			protocolFeeRecipient: zeroAddress,
			reportTimestamp: 1n,
			settlementTime: 10n,
			settlementTimestamp: 0n,
			settlerRewardAttoEth: 0n,
			token1: token1Address,
			token2: token2Address,
		},
		helper: { blockNumber: 1n, blockTimestamp: 1n, creator: initialReporter, reportId },
	}
}

function readStoredOracleFixture(functionName: string, preimage: OpenOracleStatePreimage) {
	switch (functionName) {
		case 'storedGame':
			return getOpenOracleGameTuple(preimage.game)
		case 'storedHelper':
			return [preimage.helper.creator, preimage.helper.blockTimestamp, preimage.helper.blockNumber]
		case 'disputeHistory':
			return [100n, 10n, 0n, 1n]
		case 'oracleGame':
			return hashOpenOracleStatePreimage(preimage)
		default:
			throw new Error(`Unexpected read: ${functionName}`)
	}
}

// The reporter wallet only signs; any RPC it would send directly is a test failure.
function createOfflineReporterWallet() {
	return createWalletClient({
		account: initialReporter,
		chain: SEPOLIA_NETWORK_PROFILE.chain,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected RPC')
			},
		}),
	}).extend(publicActions)
}

function createDisputePreimage(timeType: boolean) {
	const preimage = createOpenOraclePreimage()
	preimage.game.reportTimestamp = 100n
	preimage.game.settlementTime = 1_000n
	if (!timeType) preimage.game.flags &= ~OPEN_ORACLE_FLAG_TIME_TYPE
	return preimage
}

describe('openOracle protocol client', () => {
	for (const timeType of [true, false]) {
		for (const remaining of [0n, 1n, timeType ? 60n : 2n, timeType ? 61n : 3n]) {
			test(`dispute checks ${remaining} remaining ${timeType ? 'seconds' : 'blocks'} before sending`, async () => {
				const preimage = createDisputePreimage(timeType)
				let sent = 0
				const writer = createMockWriteClient(
					() => sent++,
					async request => readStoredOracleFixture(request.functionName, preimage),
				)
				const reader = createMockLoaderClient({ getBlock: async () => ({ timestamp: timeType ? 1_100n - remaining : 1n, number: timeType ? 1n : 1_100n - remaining }), multicall: async () => [], readContract: async request => readStoredOracleFixture(request.functionName, preimage) })
				const wallet = createOfflineReporterWallet()
				const attempt = disputeOracleReport({ ...wallet, ...asWriteClient(writer), ...reader, account: wallet.account }, getOpenOracleAddress(), 1n, token2Address, 101n, 11n, 10n, hashOpenOracleStatePreimage(preimage))
				if (remaining > (timeType ? 60n : 2n)) {
					await attempt
					expect(sent).toBe(1)
				} else {
					await expect(attempt).rejects.toThrow('Dispute window ends too soon')
					expect(sent).toBe(0)
				}
			})
		}
	}

	for (const timeType of [true, false]) {
		const reserve = timeType ? 60n : 2n
		for (const remaining of [1n, reserve, reserve + 1n]) {
			test(`rechecks dispute after wallet review with ${remaining} ${timeType ? 'seconds' : 'blocks'} remaining`, async () => {
				const preimage = createDisputePreimage(timeType)
				let currentClock = 1_000n
				let sent = 0
				let validations = 0
				const writer = createMockWriteClient(
					() => sent++,
					async request => readStoredOracleFixture(request.functionName, preimage),
				)
				const reader = createMockLoaderClient({ getBlock: async () => ({ timestamp: timeType ? currentClock : 1n, number: timeType ? 1n : currentClock }), multicall: async () => [], readContract: async request => readStoredOracleFixture(request.functionName, preimage) })
				const wallet = createOfflineReporterWallet()
				const reviewed = createReviewedClient({ ...wallet, ...asWriteClient(writer), ...reader, account: wallet.account, call: async () => ({ data: toHex(0n) }) }, async () => {
					if (++validations === 2) currentClock = 1_100n - remaining
				})
				const attempt = disputeOracleReport(reviewed, getOpenOracleAddress(), 1n, token2Address, 101n, 11n, 10n, hashOpenOracleStatePreimage(preimage))
				if (remaining > reserve) {
					await attempt
					expect(sent).toBe(1)
				} else {
					await expect(attempt).rejects.toThrow('Dispute window ends too soon')
					expect(sent).toBe(0)
				}
				expect(validations).toBe(2)
			})
		}
	}

	test('normalizes displayed report prices for different token decimals', async () => {
		const preimage = createOpenOraclePreimage()
		preimage.game.currentAmount1 = 10n ** 18n
		preimage.game.currentAmount2 = 3000n * 10n ** 6n
		const client = createMockLoaderClient({
			getBlock: async () => ({ number: 1n, timestamp: 2n }),
			multicall: createOpenOracleMulticall({ tokens: { [token1Address]: { decimals: 18n, symbol: 'ONE' }, [token2Address]: { decimals: 6n, symbol: 'TWO' } } }),
			readContract: async request => readStoredOracleFixture(request.functionName, preimage),
		})
		const report = await loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)
		expect(report.price).toBe(3000n * 10n ** 30n)
	})

	test('exposes fee and escalation flags on loaded report details', async () => {
		const preimage = createOpenOraclePreimage()
		const client = createMockLoaderClient({
			getBlock: async () => ({ number: 1n, timestamp: 2n }),
			multicall: createOpenOracleMulticall({ tokens: defaultTokenFixtures }),
			readContract: async request => readStoredOracleFixture(request.functionName, preimage),
		})
		const defaultReport = await loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)
		expect(defaultReport.feesOnlyAtHalt).toBe(false)
		expect(defaultReport.flexibleEscalation).toBe(false)
		preimage.game.flags |= (1n << 5n) | (1n << 6n)
		const flaggedReport = await loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)
		expect(flaggedReport.feesOnlyAtHalt).toBe(true)
		expect(flaggedReport.flexibleEscalation).toBe(true)
	})

	test('loads stored oracle reports with log access disabled', async () => {
		const preimage = createOpenOraclePreimage()
		preimage.game.flags |= OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES
		const client = createMockLoaderClient({
			getBlock: async () => ({ number: 1n, timestamp: 2n }),
			getLogs: async () => {
				throw new Error('Log access unavailable')
			},
			multicall: createOpenOracleMulticall({ tokens: defaultTokenFixtures }),
			readContract: async request => {
				switch (request.functionName) {
					case 'storedGame':
						return getOpenOracleGameTuple(preimage.game)
					case 'storedHelper':
						return [initialReporter, 1n, 1n]
					case 'disputeHistory':
						return [100n, 10n, 0n, 1n]
					case 'oracleGame':
						return hashOpenOracleStatePreimage(preimage)
					default:
						throw new Error(`Unexpected read: ${request.functionName}`)
				}
			},
		})
		const report = await loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)
		expect(report.currentAmount1).toBe(100n)
		expect(report.initialReporter).toBe(initialReporter)
		preimage.game.numReports = 2n
		preimage.game.currentAmount1 = 200n
		preimage.game.settlementTimestamp = 2n
		const settled = await loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)
		expect(settled.isDistributed).toBe(true)
		expect(settled.numReports).toBe(2n)
		expect(settled.initialReporter).toBeUndefined()
		expect(settled.exactToken1Report).toBe(100n)
		const invalidHashClient = { ...client, readContract: createMockLoaderClient({ getBlock: client.getBlock, multicall: async () => [], readContract: async request => (request.functionName === 'oracleGame' ? `0x${'11'.repeat(32)}` : readStoredOracleFixture(request.functionName, preimage)) }).readContract }
		await expect(loadOpenOracleReportDetails(invalidHashClient, getOpenOracleAddress(), 1n)).rejects.toThrow('stored state does not match')
		preimage.game.flags = 0n
		await expect(loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)).rejects.toThrow('was created without stored state')
	})

	test('keeps supported reports browsable alongside a report without stored state', async () => {
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(1n),
			getLogs: async () => {
				throw new Error('Log access unavailable')
			},
			multicall: createOpenOracleMulticall({ tokens: defaultTokenFixtures }),
			readContract: async request => {
				if (request.functionName === 'nextReportId') return 3n
				const reportId = request.args?.[0]
				if (typeof reportId !== 'bigint') throw new Error('Missing report id')
				const preimage = createOpenOraclePreimage(reportId)
				if (reportId === 2n) preimage.game.flags = 0n
				return readStoredOracleFixture(request.functionName, preimage)
			},
		})
		const page = await loadOpenOracleReportSummaries(client, 0, 10)
		expect(page.reportCount).toBe(2n)
		expect(page.reports.map(report => report.reportId)).toEqual([1n])
		expect(page.unavailableReports).toEqual([{ reportId: 2n, message: 'OpenOracle report #2 is unavailable: it was created without stored state and dispute history.' }])
	})

	test('derives the dispute contribution token from the strict proposed-price direction', () => {
		const { currentAmount1, currentAmount2 } = createOpenOraclePreimage().game
		expect(getOpenOracleDisputeSwapTokenKey({ currentAmount1, currentAmount2, newAmount1: 100n, newAmount2: 11n })).toBe('token2')
		expect(getOpenOracleDisputeSwapTokenKey({ currentAmount1, currentAmount2, newAmount1: 100n, newAmount2: 9n })).toBe('token1')
		expect(getOpenOracleDisputeSwapTokenKey({ currentAmount1, currentAmount2, newAmount1: 100n, newAmount2: 10n })).toBe('token1')
	})

	test('loadOpenOracleReportSummaries keeps reports disputed when dispute history returns to the initial reporter', async () => {
		const initial = createOpenOraclePreimage()
		initial.game.flags = OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES
		const disputed = { ...initial, game: { ...initial.game, numReports: 2n, reportTimestamp: 2n } }
		const client = createMockLoaderClient({
			getBlock: async () => ({ number: 1n, timestamp: 0n }),
			getLogs: async () => {
				throw new Error('Log access unavailable')
			},
			multicall: createOpenOracleMulticall({ tokens: defaultTokenFixtures }),
			readContract: async request => {
				if (request.functionName === 'nextReportId') return 2n
				return readStoredOracleFixture(request.functionName, disputed)
			},
		})

		const page = await loadOpenOracleReportSummaries(client, 0, 10)
		const [report] = page.reports
		if (report === undefined) throw new Error('Expected one open oracle report summary')

		expect(report.currentReporter).toBe(initialReporter)
		expect(report.disputeOccurred).toBe(true)
		expect(report.timeType).toBe(false)
	})

	test('loadOpenOracleReportDetails rejects invalid token decimals', async () => {
		const preimage = createOpenOraclePreimage()
		const client = createMockLoaderClient({
			getBlock: async () => ({ number: 1n, timestamp: 0n }),
			getLogs: async () => {
				throw new Error('Log access unavailable')
			},
			multicall: createOpenOracleMulticall({ tokens: { [token1Address]: { decimals: 256n, symbol: 'REP' }, [token2Address]: { decimals: 18n, symbol: 'TOK' } } }),
			readContract: async request => {
				if (request.functionName === 'oracleGame') return hashOpenOracleStatePreimage(preimage)
				return readStoredOracleFixture(request.functionName, preimage)
			},
		})

		await expect(loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)).rejects.toThrow(`Token metadata for ${token1Address} returned invalid decimals`)
	})

	// Configured WETH must still report WETH metadata; a summary page lists such a report as unavailable instead (#1481).
	test('loadOpenOracleReportDetails rejects mismatched configured WETH metadata', async () => {
		const preimage = createOpenOraclePreimage()
		preimage.game.token2 = wethAddress
		const client = createReportClient(preimage, createOpenOracleMulticall({ tokens: { [token1Address]: { decimals: 18n, symbol: 'REP' }, [wethAddress]: { decimals: 18n, symbol: 'ETH' } } }))
		await expect(loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)).rejects.toThrow(`WETH metadata is invalid for ${wethAddress}`)
	})

	for (const association of ['verified', 'different oracle', 'different coordinator', 'generic callback'] as const) {
		test(`report freshness is attached only to a verified pool coordinator: ${association}`, async () => {
			const preimage = createOpenOraclePreimage()
			preimage.game.callbackContract = vaultAddress
			const client = createMockLoaderClient({
				getBlock: async () => ({ number: 1n, timestamp: 12n }),
				readContract: async request => readStoredOracleFixture(request.functionName, preimage),
				multicall: async request => {
					const first = getContractFunctionName(request.contracts[0])
					if (first === 'decimals' || first === 'feed') return await createOpenOracleMulticall({ tokens: defaultTokenFixtures })(request)
					if (first === 'openOracle')
						return association === 'generic callback'
							? [
									{ status: 'failure', error: new Error('No such getter') },
									{ status: 'failure', error: new Error('No such getter') },
								]
							: [
									{ status: 'success', result: association === 'different oracle' ? token1Address : getOpenOracleAddress() },
									{ status: 'success', result: alternateSecurityPoolAddress },
								]
					if (first === 'openOraclePriceCoordinator') return [{ status: 'success', result: association === 'different coordinator' ? token1Address : vaultAddress }]
					throw new Error(`Unexpected multicall ${first}`)
				},
			})
			const report = await loadOpenOracleReportDetails(client, getOpenOracleAddress(), 1n)
			if (association === 'verified') expect(report.coordinatorPriceValidUntilTimestamp).toBe(getOracleManagerPriceValidUntilTimestamp(11n))
			else expect(report.coordinatorPriceValidUntilTimestamp).toBeUndefined()
		})
	}

	for (const registered of [true, false]) {
		test(`shared report preview uses authenticated feed validity: ${registered}`, async () => {
			const { game } = createOpenOraclePreimage()
			game.callbackContract = vaultAddress
			game.settlementTime = 480n
			const client = createMockLoaderClient({
				getBlock: async () => ({ timestamp: 0n }),
				readContract: async () => {
					throw new Error('Unexpected single read')
				},
				multicall: async request => {
					switch (getContractFunctionName(request.contracts[0])) {
						case 'openOracle':
							return [
								{ status: 'success', result: getOpenOracleAddress() },
								{ status: 'failure', error: new Error('Shared feed has no single question') },
							]
						case 'feed':
							return [
								{ status: 'success', result: vaultAddress },
								{ status: 'success', result: 1n },
							]
						case 'reportCandidates':
							return [{ status: 'success', result: [vaultAddress, initialReporter, alternateSecurityPoolAddress, 0n] }]
						case 'securityPoolFactory':
							return [
								{ status: 'success', result: getInfraContractAddresses().securityPoolFactory },
								{ status: 'success', result: alternateSecurityPoolAddress },
								{ status: 'success', result: 0n },
								{ status: 'success', result: game.token1 },
								{ status: 'success', result: game.token2 },
							]
						case 'sharedPriceFeeds':
							return [
								{ status: 'success', result: registered ? vaultAddress : zeroAddress },
								{ status: 'success', result: 780n },
							]
						default:
							throw new Error('Unexpected shared feed read')
					}
				},
			})
			expect(await loadCoordinatorPriceValidUntilTimestamp(client, getOpenOracleAddress(), game, undefined, 1n)).toBe(registered ? game.reportTimestamp + 480n + 780n : undefined)
		})
	}

	const settlementOutcomes = {
		accepted: { eventName: 'PriceReported', data: encodeAbiParameters(parseAbiParameters('uint256,uint256'), [123n, 11n]), expected: { status: 'accepted' } },
		rejected: { eventName: 'PriceReportRejected', data: encodeAbiParameters(parseAbiParameters('string,uint256,uint256,uint256,uint256'), ['Report uneconomic', 0n, 0n, 0n, 0n]), expected: { status: 'rejected', reason: 'Report uneconomic' } },
		deferred: { eventName: 'PriceReportDeferred', data: encodeAbiParameters(parseAbiParameters('uint256,uint256'), [34n, 33n]), expected: { status: 'deferred', maxSettlementBaseFee: 33n } },
	} as const
	for (const status of ['accepted', 'rejected', 'deferred'] as const) {
		test(`settlement filters unrelated logs before the ${status} coordinator outcome`, async () => {
			const preimage = createOpenOraclePreimage(7n)
			preimage.game.callbackContract = vaultAddress
			const abi = statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi
			const { data, eventName } = settlementOutcomes[status]
			const log = { address: vaultAddress, data, topics: encodeEventTopics({ abi, eventName, args: { reportId: 7n } }) }
			const logs = [{ ...log, address: token1Address }, { ...log, topics: encodeEventTopics({ abi, eventName, args: { reportId: 8n } }) }, { ...log, topics: [] }, log]
			const client = { ...createMockWriteClient(() => {}), waitForTransactionReceipt: async () => ({ status: 'success' as const, logs }) }
			const result = await settleOracleReport(client, getOpenOracleAddress(), 7n, preimage)
			expect(result.priceSettlement).toEqual(settlementOutcomes[status].expected)
		})
	}

	for (const accepted of [true, false]) {
		test(`isolated report escrow attributes its feed settlement outcome: ${accepted}`, async () => {
			const preimage = createOpenOraclePreimage(7n)
			preimage.game.callbackContract = vaultAddress
			const feedAbi = statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi
			const escrowAbi = parseAbi(['event ReportCompleted(uint256 indexed reportId,address indexed priceFeed,uint8 outcome)'])
			const completed = { address: vaultAddress, data: encodeAbiParameters(parseAbiParameters('uint8'), [accepted ? 1 : 2]), topics: encodeEventTopics({ abi: escrowAbi, eventName: 'ReportCompleted', args: { reportId: 7n, priceFeed: alternateSecurityPoolAddress } }) }
			const eventName = accepted ? ('PriceReported' as const) : ('PriceReportRejected' as const)
			const result = {
				address: alternateSecurityPoolAddress,
				data: accepted ? encodeAbiParameters(parseAbiParameters('uint256,uint256'), [123n, 11n]) : encodeAbiParameters(parseAbiParameters('string,uint256,uint256,uint256,uint256'), ['Report stale', 0n, 0n, 0n, 0n]),
				topics: encodeEventTopics({ abi: feedAbi, eventName, args: { reportId: 7n } }),
			}
			const client = { ...createMockWriteClient(() => {}), waitForTransactionReceipt: async () => ({ status: 'success' as const, logs: [result, completed] }) }
			expect((await settleOracleReport(client, getOpenOracleAddress(), 7n, preimage)).priceSettlement).toEqual(accepted ? { status: 'accepted' } : { status: 'rejected', reason: 'Report stale' })
		})
	}

	test('settlement returns the coordinator rejection even when the transaction succeeds', async () => {
		const preimage = createOpenOraclePreimage(7n)
		preimage.game.callbackContract = vaultAddress
		const abi = statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi
		const rejection = {
			address: vaultAddress,
			data: encodeAbiParameters(parseAbiParameters('string,uint256,uint256,uint256,uint256'), ['Report stale', 0n, 0n, 0n, 0n]),
			topics: encodeEventTopics({ abi, eventName: 'PriceReportRejected', args: { reportId: 7n } }),
		}
		const client = {
			...createMockWriteClient(() => {}),
			waitForTransactionReceipt: async () => ({ status: 'success' as const, logs: [rejection] }),
		}
		const result = await settleOracleReport(client, getOpenOracleAddress(), 7n, preimage)
		expect(result.priceSettlement).toEqual({ status: 'rejected', reason: 'Report stale' })
	})

	test('settleOracleReport sends settle with an explicit gas limit', async () => {
		const reporter = getAddress('0x00000000000000000000000000000000000000e1')
		let capturedData: Hex | undefined
		let capturedGas: bigint | undefined
		let capturedTo: Address | null | undefined
		const client = createMockWriteClient(request => {
			capturedData = request.data
			capturedGas = request.gas
			capturedTo = request.to
		})

		await settleOracleReport(client, getOpenOracleAddress(), 7n, {
			game: {
				callbackContract: zeroAddress,
				callbackGasLimit: 0n,
				currentAmount1: 1n,
				currentAmount2: 2n,
				currentReporter: reporter,
				disputeDelay: 0n,
				escalationHalt: 0n,
				feePercentage: 0n,
				flags: 0n,
				lastReportOppoTime: 1n,
				multiplier: 100n,
				numReports: 1n,
				protocolFee: 0n,
				protocolFeeRecipient: zeroAddress,
				reportTimestamp: 1n,
				settlementTime: 1n,
				settlementTimestamp: 0n,
				settlerRewardAttoEth: 0n,
				token1: token1Address,
				token2: token2Address,
			},
			helper: { blockNumber: 1n, blockTimestamp: 1n, creator: reporter, reportId: 7n },
		})

		expect(capturedTo).toBe(getOpenOracleAddress())
		expect(capturedGas).toBe(5_000_000n)
		expect(capturedData).toBeDefined()
		const decodedCall = decodeFunctionData({
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		expect(decodedCall.functionName).toBe('settle')
		expect(decodedCall.args?.[0]).toBe(7n)
	})

	test('settleOracleReport raises the gas limit to cover a large settlement callback', async () => {
		const callbackGasLimit = 7_000_000n
		const preimage = createOpenOraclePreimage(7n)
		preimage.game.callbackContract = getAddress('0x00000000000000000000000000000000000000f9')
		preimage.game.callbackGasLimit = callbackGasLimit
		let capturedGas: bigint | undefined
		const client = createMockWriteClient(request => {
			capturedGas = request.gas
		})

		await settleOracleReport(client, getOpenOracleAddress(), 7n, preimage)
		// EIP-150 forwards at most 63/64 of the remaining gas, and settle requires callbackGasLimit / 63 to remain afterwards.
		expect(capturedGas ?? 0n).toBeGreaterThan((callbackGasLimit * 64n) / 63n + callbackGasLimit / 63n)
		// An untrusted callback may also spend its budget on return data, but no request may exceed one transaction's gas cap.
		expect(capturedGas ?? 0n).toBeGreaterThanOrEqual(2n * callbackGasLimit)
		expect(capturedGas ?? 0n).toBeLessThanOrEqual(16_777_216n)

		capturedGas = undefined
		preimage.game.callbackGasLimit = 10_000_000n
		await expect(settleOracleReport(client, getOpenOracleAddress(), 7n, preimage)).rejects.toThrow('more gas than one transaction allows')
		expect(capturedGas).toBeUndefined()

		preimage.game.callbackGasLimit = 1_000n
		await settleOracleReport(client, getOpenOracleAddress(), 7n, preimage)
		expect(capturedGas).toBe(5_000_000n)
	})

	test('loads sentinel-adjusted balances and keeps a failed withdrawal retryable', async () => {
		const holder = getAddress('0x00000000000000000000000000000000000000f1')
		const requestedTokens: Address[] = []
		const readClient = createMockLoaderClient({
			getBlock: async () => ({ timestamp: 0n }),
			multicall: async () => [],
			readContract: async request => {
				if (request.functionName !== 'tokenHolder') throw new Error(`Unexpected read ${request.functionName}`)
				const token = request.args?.[1]
				if (typeof token !== 'string') throw new Error('Expected tokenHolder token')
				requestedTokens.push(getAddress(token))
				if (token === zeroAddress) return 6n
				if (token === token1Address) return 8n
				if (token === token2Address) return 10n
				throw new Error(`Unexpected token ${token}`)
			},
		})

		await expect(loadOpenOracleWithdrawableBalances(readClient, getOpenOracleAddress(), holder, token1Address, token2Address)).resolves.toEqual({
			ethAttoEth: 5n,
			token1: 7n,
			token2: 9n,
		})
		expect(requestedTokens).toEqual([zeroAddress, token1Address, token2Address])

		let withdrawalAttempts = 0
		const writeClient = createMockWriteClient(request => {
			withdrawalAttempts += 1
			if (withdrawalAttempts === 1) throw new Error('wallet rejected withdrawal')
			const data = request.data
			if (data === undefined) throw new Error('Expected withdrawal calldata')
			const decodedCall = decodeFunctionData({ abi: statoblast_openOracle_OpenOracle_OpenOracle.abi, data })
			expect(decodedCall.functionName).toBe('withdrawTo')
			expect(decodedCall.args).toEqual([token1Address, 7n, holder])
		})

		await expect(withdrawOpenOracleBalance(writeClient, getOpenOracleAddress(), token1Address, 7n, holder)).rejects.toThrow('wallet rejected withdrawal')
		await expect(withdrawOpenOracleBalance(writeClient, getOpenOracleAddress(), token1Address, 7n, holder)).resolves.toMatchObject({ action: 'withdrawBalance' })
		expect(withdrawalAttempts).toBe(2)
	})
})

for (const change of ['settlement preimage', 'settled report', 'withdraw balance', 'create ETH', 'settlement unchanged', 'settlement price expiry', 'settlement stale unchanged', 'withdraw unchanged', 'create unchanged'] as const) {
	test(`refreshes OpenOracle ${change} after application review`, async () => {
		const preimage = createOpenOraclePreimage()
		const coordinatorReport = change === 'settlement price expiry' || change === 'settlement stale unchanged'
		if (coordinatorReport) preimage.game.callbackContract = vaultAddress
		let changed = false
		let submitted = 0
		const writer = createMockWriteClient(
			() => {
				submitted += 1
			},
			async request => {
				if (request.functionName === 'tokenHolder') return changed && change === 'withdraw balance' ? 1n : 1000n
				if (request.functionName === 'balanceOf' || request.functionName === 'allowance') return 1000n
				if (request.functionName === 'symbol') return 'REP'
				if (request.functionName === 'decimals') return 18
				return readStoredOracleFixture(request.functionName, preimage)
			},
		)
		const wallet = createOfflineReporterWallet()
		const scope = new AbortController()
		const reviewed = createReviewedClient(
			{
				...wallet,
				...asWriteClient(writer),
				account: wallet.account,
				call: async () => ({ data: toHex(0n) }),
				multicall: createMulticallStub(async request =>
					getContractFunctionName(request.contracts[0]) === 'openOracle'
						? [
								{ status: 'success', result: getOpenOracleAddress() },
								{ status: 'success', result: alternateSecurityPoolAddress },
							]
						: [{ status: 'success', result: vaultAddress }],
				),
				getBlock: async () => createBlockWithTimestamp(change === 'settlement stale unchanged' || (changed && change === 'settlement price expiry') ? 3611n : 1000n),
				getBalance: async () => (changed && change === 'create ETH' ? 0n : 1000n),
			},
			undefined,
			scope.signal,
		)
		const acceptPlan = reviewed.onTransactionPlan
		reviewed.onTransactionPlan = plan => acceptPlan?.(plan.map(step => ({ ...step, requireReview: true })))
		try {
			const execute = () => {
				if (change.startsWith('withdraw')) return withdrawOpenOracleBalance(reviewed, getOpenOracleAddress(), token1Address, 7n, initialReporter)
				if (change.startsWith('create'))
					return createOpenOracleReportInstance(reviewed, {
						disputeDelay: 0,
						escalationHalt: 1000n,
						exactToken1Report: 1n,
						initialToken2Amount: 1n,
						ethValueAttoEth: 1n,
						feePercentage: 0,
						multiplier: 100,
						protocolFee: 0,
						settlementTime: 1000,
						settlerRewardAttoEth: 1n,
						token1Address,
						token2Address,
					})
				return settleOracleReport(reviewed, getOpenOracleAddress(), 1n)
			}
			const action = execute().catch(error => error)
			for (let attempt = 0; attempt < 100 && transactionSteps.value?.steps.at(-1)?.phase !== 'review'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 1))
			expect(transactionSteps.value?.steps.at(-1)?.phase).toBe('review')
			if (change === 'settlement stale unchanged') expect(transactionSteps.value?.steps.at(-1)?.description).toBe('Settlement will clear this report, but the pool will reject its price.')
			changed = true
			if (change === 'settlement preimage') preimage.game.currentAmount1 = 101n
			if (change === 'settled report') preimage.game.settlementTimestamp = 1000n
			transactionSteps.value?.confirm()
			const result = await action
			if (change.endsWith('unchanged')) {
				expect(result).toHaveProperty('hash')
				expect(submitted).toBe(1)
				if (change === 'settlement stale unchanged') expect(result).toHaveProperty('priceSettlement', { status: 'unconfirmed' })
			} else {
				expect(result).toBeInstanceOf(Error)
				expect(submitted).toBe(0)
				if (change === 'settlement price expiry') expect(result.message).toContain('Price expired while reviewing')
			}
		} finally {
			scope.abort()
			transactionSteps.value?.cancel()
		}
	})
}

for (const scenario of ['callback gas', 'return bomb', 'settlement duration'] as const)
	test(`#1456 refuses a dispute with unsafe ${scenario} before writing`, async () => {
		const preimage = createDisputePreimage(true)
		if (scenario === 'settlement duration') preimage.game.settlementTime = 2n ** 48n - 1n
		else {
			preimage.game.callbackContract = vaultAddress
			preimage.game.callbackGasLimit = scenario === 'return bomb' ? 9_000_000n : 2n ** 32n - 1n
		}
		let sent = 0
		const writer = createMockWriteClient(
			() => sent++,
			async request => readStoredOracleFixture(request.functionName, preimage),
		)
		const reader = createMockLoaderClient({ getBlock: async () => ({ timestamp: 200n, number: 2n }), multicall: async () => [], readContract: async request => readStoredOracleFixture(request.functionName, preimage) })
		const wallet = createOfflineReporterWallet()
		await expect(disputeOracleReport({ ...wallet, ...asWriteClient(writer), ...reader, account: wallet.account }, getOpenOracleAddress(), 1n, token2Address, 101n, 11n, 10n, hashOpenOracleStatePreimage(preimage))).rejects.toThrow('settlement')
		expect(sent).toBe(0)
	})

test('#1456: unsafe settlement disables dispute availability with a reason', () => {
	const report = { callbackContract: vaultAddress, callbackGasLimit: 9_000_000, trustedSettlementCallback: false, currentBlockNumber: 10n, currentReporter: initialReporter, currentTime: 200n, disputeDelay: 0n, isDistributed: false, reportTimestamp: 100n, settlementTime: 1000n, timeType: true }
	expect(getOpenOracleDisputeAvailability(report)).toMatchObject({ canAct: false, message: expect.stringContaining('settlement gas') })
	expect(getOpenOracleDisputeAvailability({ ...report, callbackGasLimit: 100_000 }).canAct).toBe(true)
	expect(getOpenOracleDisputeAvailability({ ...report, callbackContract: zeroAddress, settlementTime: 2n ** 48n - 1n })).toMatchObject({ canAct: false, message: expect.stringContaining('settlement duration') })
})

const feedEscrowAddress = getAddress('0x00000000000000000000000000000000000000e5')
const sharedFeedAddress = getAddress('0x00000000000000000000000000000000000000f5')
const feedPortfolioAddress = getAddress('0x00000000000000000000000000000000000000a5')
const childRepAddress = getAddress('0x00000000000000000000000000000000000000b5')

type TokenFixture = { decimals?: bigint; symbol?: string; universeId?: bigint }
const defaultTokenFixtures: Record<Address, TokenFixture> = { [token1Address]: { decimals: 18n, symbol: 'ONE' }, [token2Address]: { decimals: 18n, symbol: 'TWO' } }

function getContractAddress(contract: unknown) {
	if (typeof contract !== 'object' || contract === null || !('address' in contract) || typeof contract.address !== 'string') throw new Error('Unexpected multicall contract')
	return getAddress(contract.address)
}

function getContractArgs(contract: unknown) {
	if (typeof contract !== 'object' || contract === null || !('args' in contract) || !Array.isArray(contract.args)) return []
	return contract.args
}

const success = (result: unknown) => ({ status: 'success', result })
const failure = () => ({ status: 'failure', error: new Error('execution reverted') })

/** Answers the allow-failure reads the OpenOracle loaders make: token metadata, Zoltar REP identity and feed escrow authentication. */
function createOpenOracleMulticall({ tokens, universeTokens = {}, escrow }: { tokens: Record<Address, TokenFixture>; universeTokens?: Record<string, Address>; escrow?: { registered: boolean; candidate: Address } }) {
	return async (request: { contracts: readonly unknown[] }) => {
		const first = getContractFunctionName(request.contracts[0])
		if (first === 'decimals')
			return request.contracts.map(contract => {
				const functionName = getContractFunctionName(contract)
				if (functionName !== 'decimals' && functionName !== 'symbol' && functionName !== 'universeId') throw new Error(`Unexpected token read ${functionName}`)
				const value = tokens[getContractAddress(contract)]?.[functionName]
				return value === undefined ? failure() : success(value)
			})
		if (first === 'universes')
			return request.contracts.map(contract => {
				const universeId = getContractArgs(contract)[0]
				const token = typeof universeId === 'bigint' ? universeTokens[universeId.toString()] : undefined
				return token === undefined ? success([0n, 0n, 0n, zeroAddress, 0n]) : success([0n, 0n, 0n, token, 0n])
			})
		if (first === 'openOracle') return [failure(), failure()]
		if (first === 'feed') return escrow === undefined ? [failure()] : [success(sharedFeedAddress)]
		if (first === 'reportCandidates') {
			if (escrow === undefined) throw new Error('Unexpected feed read')
			return [success([escrow.candidate, initialReporter, alternateSecurityPoolAddress, 0n]), success(getInfraContractAddresses().securityPoolFactory), success(feedPortfolioAddress), success(0n), success(getOpenOracleAddress())]
		}
		if (first === 'sharedPriceFeeds') return [success(escrow?.registered === true ? sharedFeedAddress : zeroAddress)]
		throw new Error(`Unexpected multicall ${first}`)
	}
}

function createReportClient(preimage: OpenOracleStatePreimage, multicall: ReturnType<typeof createOpenOracleMulticall>) {
	return createMockLoaderClient({ getBlock: async () => ({ number: 2n, timestamp: 200n }), multicall, readContract: async request => readStoredOracleFixture(request.functionName, preimage) })
}

describe('#1444 OpenOracle token identity', () => {
	test.each([
		{ claimed: 'REP', token: 'token2' as const },
		{ claimed: 'WETH', token: 'token1' as const },
	])('a non-canonical token claiming $claimed is labelled with its address', async ({ claimed, token }) => {
		const preimage = createOpenOraclePreimage()
		const tokens = { [token1Address]: { decimals: 18n, symbol: token === 'token1' ? claimed : 'ONE' }, [token2Address]: { decimals: 18n, symbol: token === 'token2' ? claimed : 'TWO' } }
		const report = await loadOpenOracleReportDetails(createReportClient(preimage, createOpenOracleMulticall({ tokens })), getOpenOracleAddress(), 1n)
		const label = token === 'token1' ? report.token1Symbol : report.token2Symbol
		expect(label).not.toBe(claimed)
		expect(label).toBe(`${claimed} (${token === 'token1' ? '0x000000…0000D1' : '0x000000…0000D2'})`)
		expect(formatOpenOracleReportPriceUnit(report)).toContain(`${claimed} (0x000000`)
		expect(formatReportBrowseTitle(report.token1Symbol, report.token2Symbol, '1')).not.toContain(`${claimed} /`)
	})

	test('configured WETH and Zoltar-registered REP tokens keep their bare symbols', async () => {
		const preimage = createOpenOraclePreimage()
		preimage.game.token1 = wethAddress
		preimage.game.token2 = getGenesisReputationTokenAddress()
		const tokens = { [wethAddress]: { decimals: 18n, symbol: 'WETH' }, [getGenesisReputationTokenAddress()]: { decimals: 18n, symbol: 'REP' } }
		const genesis = await loadOpenOracleReportDetails(createReportClient(preimage, createOpenOracleMulticall({ tokens })), getOpenOracleAddress(), 1n)
		expect([genesis.token1Symbol, genesis.token2Symbol]).toEqual(['WETH', 'REP'])

		preimage.game.token2 = childRepAddress
		const childTokens = { ...tokens, [childRepAddress]: { decimals: 18n, symbol: 'REP', universeId: 5n } }
		const child = await loadOpenOracleReportDetails(createReportClient(preimage, createOpenOracleMulticall({ tokens: childTokens, universeTokens: { '5': childRepAddress } })), getOpenOracleAddress(), 1n)
		expect(child.token2Symbol).toBe('REP')
		// A token that claims a universe Zoltar maps to another REP token stays unverified.
		const impostor = await loadOpenOracleReportDetails(createReportClient(preimage, createOpenOracleMulticall({ tokens: childTokens, universeTokens: { '5': token2Address } })), getOpenOracleAddress(), 1n)
		expect(impostor.token2Symbol).toBe('REP (0x000000…0000b5)')
	})
})

describe('#1481 OpenOracle reports with unusable token metadata', () => {
	test.each([
		{ name: 'an empty symbol', symbol: ' ' },
		{ name: 'a reverting symbol', symbol: undefined },
	])('loadOpenOracleReportDetails resolves a token with $name using an address label', async ({ symbol }) => {
		const preimage = createOpenOraclePreimage()
		const tokens = { [token1Address]: { decimals: 18n, ...(symbol === undefined ? {} : { symbol }) }, [token2Address]: { decimals: 18n, symbol: 'TWO' } }
		const report = await loadOpenOracleReportDetails(createReportClient(preimage, createOpenOracleMulticall({ tokens })), getOpenOracleAddress(), 1n)
		expect(report.token1Symbol).toBe('Token 0x000000…0000D1')
		expect(report.token1Decimals).toBe(18)
	})

	test('loadOpenOracleReportSummaries keeps good rows and lists reports with unusable token metadata as unavailable', async () => {
		const badDecimalsToken = getAddress('0x00000000000000000000000000000000000000d3')
		const noSymbolToken = getAddress('0x00000000000000000000000000000000000000d4')
		const reportTokens: Record<string, [Address, Address]> = { '1': [token1Address, token2Address], '2': [token1Address, noSymbolToken], '3': [badDecimalsToken, token2Address], '4': [wethAddress, token2Address] }
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: createOpenOracleMulticall({
				tokens: {
					[token1Address]: { decimals: 18n, symbol: 'ONE' },
					[token2Address]: { decimals: 18n, symbol: 'TWO' },
					[noSymbolToken]: { decimals: 18n },
					[badDecimalsToken]: { decimals: 256n, symbol: 'BAD' },
					[wethAddress]: { decimals: 18n, symbol: 'ETH' },
				},
			}),
			readContract: async request => {
				if (request.functionName === 'nextReportId') return 5n
				const reportId = request.args?.[0]
				if (typeof reportId !== 'bigint') throw new Error('Missing report id')
				const preimage = createOpenOraclePreimage(reportId)
				const pair = reportTokens[reportId.toString()]
				if (pair === undefined) throw new Error('Unexpected report id')
				;[preimage.game.token1, preimage.game.token2] = pair
				return readStoredOracleFixture(request.functionName, preimage)
			},
		})
		const page = await loadOpenOracleReportSummaries(client, 0, 10)
		expect(page.reports.map(report => [report.reportId, report.token1Symbol, report.token2Symbol])).toEqual([
			[2n, 'ONE (0x000000…0000D1)', 'Token 0x000000…0000D4'],
			[1n, 'ONE (0x000000…0000D1)', 'TWO (0x000000…0000D2)'],
		])
		expect(page.unavailableReports).toEqual([
			{ reportId: 4n, message: `OpenOracle report #4 is unavailable. WETH metadata is invalid for ${wethAddress}.` },
			{ reportId: 3n, message: `OpenOracle report #3 is unavailable. Token metadata for ${badDecimalsToken} returned invalid decimals.` },
		])
	})
})

describe('settlement gas for feed-authenticated escrow callbacks', () => {
	function createEscrowPreimage(callbackGasLimit: bigint) {
		const preimage = createDisputePreimage(true)
		preimage.game.callbackContract = feedEscrowAddress
		preimage.game.callbackGasLimit = callbackGasLimit
		return preimage
	}
	const tokens = { [token1Address]: { decimals: 18n, symbol: 'ONE' }, [token2Address]: { decimals: 18n, symbol: 'TWO' } }
	const transactionGasCap = 16_777_216n

	test('a registered feed escrow with a 10M callback is disputable while an untrusted 9M callback is not', async () => {
		const trusted = await loadOpenOracleReportDetails(createReportClient(createEscrowPreimage(10_000_000n), createOpenOracleMulticall({ tokens, escrow: { registered: true, candidate: feedEscrowAddress } })), getOpenOracleAddress(), 1n)
		expect(trusted.trustedSettlementCallback).toBe(true)
		expect(getOpenOracleDisputeAvailability(trusted)).toEqual({ canAct: true, message: undefined })
		for (const escrow of [{ registered: false, candidate: feedEscrowAddress }, { registered: true, candidate: vaultAddress }, undefined]) {
			const untrusted = await loadOpenOracleReportDetails(createReportClient(createEscrowPreimage(9_000_000n), createOpenOracleMulticall({ tokens, ...(escrow === undefined ? {} : { escrow }) })), getOpenOracleAddress(), 1n)
			expect(untrusted.trustedSettlementCallback).toBe(false)
			expect(getOpenOracleDisputeAvailability(untrusted)).toMatchObject({ canAct: false, message: expect.stringContaining('settlement gas') })
		}
	})

	test('disputes and settles a registered feed escrow report within the transaction gas cap', async () => {
		const callbackGasLimit = 10_000_000n
		const preimage = createEscrowPreimage(callbackGasLimit)
		const sentGas: Array<bigint | undefined> = []
		const writer = createMockWriteClient(
			request => sentGas.push(request.gas),
			async request => readStoredOracleFixture(request.functionName, preimage),
		)
		const reader = createReportClient(preimage, createOpenOracleMulticall({ tokens, escrow: { registered: true, candidate: feedEscrowAddress } }))
		const wallet = createOfflineReporterWallet()
		const client = { ...wallet, ...asWriteClient(writer), ...reader, account: wallet.account }
		await disputeOracleReport(client, getOpenOracleAddress(), 1n, token2Address, 101n, 11n, 10n, hashOpenOracleStatePreimage(preimage))
		expect(sentGas).toHaveLength(1)
		await settleOracleReport(client, getOpenOracleAddress(), 1n, preimage)
		const settleGas = sentGas[1] ?? 0n
		expect(settleGas).toBeGreaterThan((callbackGasLimit * 64n) / 63n + callbackGasLimit / 63n)
		expect(settleGas).toBeLessThanOrEqual(transactionGasCap)
	})

	test('refuses to request settle gas above the transaction cap for an untrusted callback', async () => {
		const preimage = createEscrowPreimage(9_000_000n)
		let sent = 0
		const writer = createMockWriteClient(() => sent++)
		const reader = createReportClient(preimage, createOpenOracleMulticall({ tokens, escrow: { registered: false, candidate: feedEscrowAddress } }))
		await expect(settleOracleReport({ ...asWriteClient(writer), ...reader }, getOpenOracleAddress(), 1n, preimage)).rejects.toThrow('more gas than one transaction allows')
		expect(sent).toBe(0)
	})

	test('trusted escrow settlement budgets EIP-150 forwarding without a return-data allowance', () => {
		const game = { callbackContract: feedEscrowAddress, callbackGasLimit: 10_000_000n }
		const trustedGas = getOpenOracleSettleGasLimit(game, true)
		expect(trustedGas).toBeGreaterThan((10_000_000n * 64n) / 63n + 10_000_000n / 63n)
		expect(trustedGas).toBeLessThanOrEqual(transactionGasCap)
		expect(() => getOpenOracleSettleGasLimit(game, false)).toThrow('more gas than one transaction allows')
	})
})
