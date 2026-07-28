import assert from 'node:assert/strict'
import { evaluateBuyRep, evaluateSellRep } from '../open-oracle-arbitrager/strategy.ts'
import { calculateOracleMinimumWethReport, DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS } from '../shared/ts/oracleInitialReport.ts'

const fixture = {
	baseFeeWeiPerGas: 118_491_126n,
	blockHash: '0x4aa49d2760cffd97612684d3306b8be38ce4daf7604ad0f9cbeb975159fde73e',
	blockNumber: 25_600_852n,
	blockTimestamp: 1_784_875_091n,
	buyRep: {
		callData:
			'0xbd21704a000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000221657776846890989a759ba2973e427dff5c9bb00000000000000000000000000000000000000000000006e709a3502bc60275c00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000',
		outputs: [1_443_517_056_219_248_199n, 2_831_322_171_024_499_199_808_441_211n, 0n, 114_157n],
	},
	cheapRepAmount: 2_227_204_424_255_513_151_233n,
	expensiveRepAmount: 2_015_089_717_183_559_517_782n,
	midReportRep: 2_121_147_070_719_536_334_508n,
	quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
	rep: '0x221657776846890989a759BA2973e427DfF5C9bB',
	sellRep: {
		callData:
			'0xc6a5026a000000000000000000000000221657776846890989a759ba2973e427dff5c9bb000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000078bcab9fa02841c70100000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000000',
		outputs: [571_016_899_230_348_553n, 1_045_277_023_077_399_918_283_071_048n, 0n, 87_765n],
	},
	weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
} as const

const gasStressExpectations = [
	[0n, 807_692_307_692_307_693n],
	[1n, 888_461_538_461_538_463n],
	[5n, 1_211_538_461_538_461_540n],
	[10n, 1_615_384_615_384_615_386n],
	[20n, 2_423_076_923_076_923_078n],
	[50n, 4_846_153_846_153_846_155n],
	[100n, 8_884_615_384_615_384_617n],
	[200n, 16_961_538_461_538_461_540n],
] as const

function minimumReport(baseFeeWeiPerGas: bigint) {
	return calculateOracleMinimumWethReport({
		...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
		baseFeeWeiPerGas,
	})
}

function verifyRecordedEconomics() {
	const minimumWeth = minimumReport(fixture.baseFeeWeiPerGas)
	assert.equal(minimumWeth, 817_262_744_792_307_693n)
	assert.equal((fixture.midReportRep * 105n) / 100n, fixture.cheapRepAmount)
	assert.equal((fixture.midReportRep * 95n) / 100n, fixture.expensiveRepAmount)

	for (const [baseFeeGwei, expectedMinimumWeth] of gasStressExpectations) {
		assert.equal(minimumReport(baseFeeGwei * 10n ** 9n), expectedMinimumWeth)
	}

	const commonGame = {
		currentAmount1: minimumWeth,
		feePercentage: 10_000n,
		protocolFee: 100_000n,
		token1: fixture.weth,
		token2: fixture.rep,
	}
	const sell = evaluateSellRep({ ...commonGame, currentAmount2: fixture.cheapRepAmount }, fixture.sellRep.outputs[0], 0n)
	assert.equal(sell.hedgeCostWeth, 826_252_634_985_023_076n)
	assert.equal(sell.profitBeforeGasWeth, -255_235_735_754_674_523n)

	const buy = evaluateBuyRep({ ...commonGame, currentAmount2: fixture.expensiveRepAmount }, fixture.buyRep.outputs[0], 0n)
	assert.equal(buy.hedgeAmountRep, 2_037_255_704_072_578_672_476n)
	assert.equal(buy.profitBeforeGasWeth, -626_254_311_426_940_506n)
	assert(sell.profitBeforeGasWeth < 0n)
	assert(buy.profitBeforeGasWeth < 0n)
}

async function rpcRequest(url: string, method: string, params: readonly unknown[]) {
	const response = await fetch(url, {
		body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
	})
	if (!response.ok) throw new Error(`Archive RPC returned HTTP ${response.status.toString()}`)
	const payload: unknown = await response.json()
	if (typeof payload !== 'object' || payload === null) throw new Error('Archive RPC returned a non-object response')
	if ('error' in payload) throw new Error('Archive RPC returned a JSON-RPC error')
	if (!('result' in payload)) throw new Error('Archive RPC response is missing result')
	return payload.result
}

function requiredHexField(value: unknown, field: string) {
	if (typeof value !== 'object' || value === null) throw new Error(`Archive block is missing ${field}`)
	const fieldValue = Object.entries(value).find(([name]) => name === field)?.[1]
	if (typeof fieldValue !== 'string' || !/^0x[0-9a-fA-F]+$/.test(fieldValue)) throw new Error(`Archive block has invalid ${field}`)
	return fieldValue
}

function decodeWords(value: unknown) {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{256}$/.test(value)) throw new Error('Archive Quoter result is not four ABI words')
	const words: bigint[] = []
	for (let offset = 2; offset < value.length; offset += 64) {
		words.push(BigInt(`0x${value.slice(offset, offset + 64)}`))
	}
	return words
}

async function verifyArchiveReplay(url: string) {
	const blockTag = `0x${fixture.blockNumber.toString(16)}`
	const block = await rpcRequest(url, 'eth_getBlockByNumber', [blockTag, false])
	assert.equal(requiredHexField(block, 'hash').toLowerCase(), fixture.blockHash)
	assert.equal(BigInt(requiredHexField(block, 'number')), fixture.blockNumber)
	assert.equal(BigInt(requiredHexField(block, 'timestamp')), fixture.blockTimestamp)
	assert.equal(BigInt(requiredHexField(block, 'baseFeePerGas')), fixture.baseFeeWeiPerGas)

	for (const quote of [fixture.sellRep, fixture.buyRep]) {
		const result = await rpcRequest(url, 'eth_call', [{ data: quote.callData, to: fixture.quoter }, blockTag])
		assert.deepEqual(decodeWords(result), [...quote.outputs])
	}
}

verifyRecordedEconomics()
const archiveRpcUrl = process.env['OPEN_ORACLE_ARCHIVE_RPC_URL']
if (archiveRpcUrl !== undefined && archiveRpcUrl.trim() !== '') {
	await verifyArchiveReplay(archiveRpcUrl)
	console.log('OpenOracle pinned market fixture calculations and archive replay passed')
} else {
	console.log('OpenOracle pinned market fixture calculations passed; set OPEN_ORACLE_ARCHIVE_RPC_URL for the archive replay')
}
