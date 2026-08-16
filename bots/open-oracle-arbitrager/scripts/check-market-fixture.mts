import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Window } from 'happy-dom'
import { calculateOracleMinimumWethReportAttoEth, DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS } from '@zoltar/shared/oracleInitialReport'
import { evaluateBuyRep, evaluateSellRep } from '#core/strategy'
import { bigintToSafeNumber } from '#ethereum'

const fixture = {
	baseFeeAttoEthPerGas: 118_491_126n,
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
	feePercentage: 10_000n,
	gasCostAttoWeth: 0n,
	midReportRep: 2_121_147_070_719_536_334_508n,
	poolFee: 10_000n,
	protocolFee: 100_000n,
	quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
	reportDeviationBps: 500n,
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

function minimumReport(baseFeeAttoEthPerGas: bigint) {
	return calculateOracleMinimumWethReportAttoEth({
		...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
		baseFeeAttoEthPerGas,
	})
}

function formatWad(value: bigint): string {
	const sign = value < 0n ? '-' : ''
	const absolute = value < 0n ? -value : value
	const whole = absolute / 10n ** 18n
	const fraction = (absolute % 10n ** 18n).toString().padStart(18, '0')
	return `${sign}${whole.toLocaleString('en-US')}.${fraction}`
}

function formatPercent(numerator: bigint, denominator: bigint): string {
	const hundredthsOfPercent = (numerator * 10_000n) / denominator
	const whole = hundredthsOfPercent / 100n
	const fraction = (hundredthsOfPercent % 100n).toString().padStart(2, '0').replace(/0+$/, '')
	return fraction === '' ? `${whole.toString()}%` : `${whole.toString()}.${fraction}%`
}

function verifyRecordedEconomics() {
	const minimumWeth = minimumReport(fixture.baseFeeAttoEthPerGas)
	assert.equal(minimumWeth, 817_262_744_792_307_693n)
	assert.equal((fixture.midReportRep * (10_000n + fixture.reportDeviationBps)) / 10_000n, fixture.cheapRepAmount)
	assert.equal((fixture.midReportRep * (10_000n - fixture.reportDeviationBps)) / 10_000n, fixture.expensiveRepAmount)
	const encodedPoolFee = fixture.poolFee.toString(16).padStart(64, '0')
	const feeWordStart = 2 + 8 + 64 * 3
	assert.equal(fixture.sellRep.callData.slice(feeWordStart, feeWordStart + 64), encodedPoolFee)
	assert.equal(fixture.buyRep.callData.slice(feeWordStart, feeWordStart + 64), encodedPoolFee)

	for (const [baseFeeGwei, expectedMinimumWeth] of gasStressExpectations) {
		assert.equal(minimumReport(baseFeeGwei * 10n ** 9n), expectedMinimumWeth)
	}

	const commonGame = {
		currentAmount1: minimumWeth,
		feePercentage: fixture.feePercentage,
		protocolFee: fixture.protocolFee,
		token1: fixture.weth,
		token2: fixture.rep,
	}
	const sell = evaluateSellRep({ ...commonGame, currentAmount2: fixture.cheapRepAmount }, fixture.sellRep.outputs[0], fixture.gasCostAttoWeth)
	assert.equal(sell.hedgeCostAttoWeth, 826_252_634_985_023_076n)
	assert.equal(sell.profitBeforeGasAttoWeth, -255_235_735_754_674_523n)

	const buy = evaluateBuyRep({ ...commonGame, currentAmount2: fixture.expensiveRepAmount }, fixture.buyRep.outputs[0], fixture.gasCostAttoWeth)
	assert.equal(buy.hedgeAmountAttoRep, 2_037_255_704_072_578_672_476n)
	assert.equal(buy.profitBeforeGasAttoWeth, -626_254_311_426_940_506n)
	assert(sell.profitBeforeGasAttoWeth < 0n)
	assert(buy.profitBeforeGasAttoWeth < 0n)

	return { buy, minimumWeth, sell }
}

async function verifyDocumentedFixture() {
	const { buy, minimumWeth, sell } = verifyRecordedEconomics()
	const html = await readFile(new URL('../docs/market-fixture.html', import.meta.url), 'utf8')
	const window = new Window()
	window.document.write(html)
	window.document.close()
	const table = window.document.getElementById('open-oracle-market-fixture-inputs')
	assert(table !== null, 'Arbitrager market fixture must expose the OpenOracle fixture inputs')
	const expected: Record<string, bigint> = {
		baseFeeAttoEthPerGas: fixture.baseFeeAttoEthPerGas,
		blockNumber: fixture.blockNumber,
		buyProfitWethAttoEth: buy.profitBeforeGasAttoWeth,
		buyReportAttoRep: fixture.expensiveRepAmount,
		gasCostWethAttoEth: fixture.gasCostAttoWeth,
		midReportAttoRep: fixture.midReportRep,
		minimumWethReportAttoEth: minimumWeth,
		protocolFee: fixture.protocolFee,
		reportDeviationBps: fixture.reportDeviationBps,
		reporterFee: fixture.feePercentage,
		sellProfitWethAttoEth: sell.profitBeforeGasAttoWeth,
		sellReportAttoRep: fixture.cheapRepAmount,
		uniswapPoolFee: fixture.poolFee,
	}
	for (const [name, value] of Object.entries(expected)) {
		const attributeName = `data-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`
		assert.equal(table.getAttribute(attributeName), value.toString(), `Arbitrager OpenOracle fixture ${name} is stale`)
	}
	const deviation = formatPercent(fixture.reportDeviationBps, 10_000n)
	const poolFee = formatPercent(fixture.poolFee, 1_000_000n)
	const visibleValues: Record<string, string> = {
		blockDate: new Date(bigintToSafeNumber(fixture.blockTimestamp * 1_000n, 'Fixture block timestamp')).toISOString().slice(0, 10),
		blockNumber: fixture.blockNumber.toLocaleString('en-US'),
		buyDeviation: `−${deviation}`,
		buyExecution: `Exact-output quote through the ${poolFee} REP/WETH pool`,
		buyProfitWeth: `${formatWad(buy.profitBeforeGasAttoWeth)} WETH`,
		buyReportRep: `${formatWad(fixture.expensiveRepAmount)} REP`,
		deviationMagnitude: deviation,
		gasCostWeth: `${fixture.gasCostAttoWeth.toString()} WETH`,
		midReportRep: `${formatWad(fixture.midReportRep)} REP`,
		minimumWethReport: `${formatWad(minimumWeth)} WETH`,
		protocolFee: formatPercent(fixture.protocolFee, 10_000_000n),
		reporterFee: formatPercent(fixture.feePercentage, 10_000_000n),
		sellDeviation: `+${deviation}`,
		sellExecution: `Exact-input quote through the ${poolFee} REP/WETH pool`,
		sellProfitWeth: `${formatWad(sell.profitBeforeGasAttoWeth)} WETH`,
		sellReportRep: `${formatWad(fixture.cheapRepAmount)} REP`,
		uniswapPoolFee: poolFee,
	}
	for (const [name, value] of Object.entries(visibleValues)) {
		const visibleElements = window.document.querySelectorAll(`[data-fixture-field="${name}"]`)
		assert(visibleElements.length > 0, `Arbitrager OpenOracle fixture is missing visible ${name}`)
		for (const element of visibleElements) {
			assert.equal(element.textContent?.trim(), value, `Arbitrager OpenOracle fixture visible ${name} is stale`)
		}
	}
	window.close()
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
	assert.equal(BigInt(requiredHexField(block, 'baseFeePerGas')), fixture.baseFeeAttoEthPerGas)

	for (const quote of [fixture.sellRep, fixture.buyRep]) {
		const result = await rpcRequest(url, 'eth_call', [{ data: quote.callData, to: fixture.quoter }, blockTag])
		assert.deepEqual(decodeWords(result), [...quote.outputs])
	}
}

await verifyDocumentedFixture()
const archiveRpcUrl = process.env['OPEN_ORACLE_ARCHIVE_RPC_URL']
if (archiveRpcUrl !== undefined && archiveRpcUrl.trim() !== '') {
	await verifyArchiveReplay(archiveRpcUrl)
	console.log('OpenOracle pinned market fixture calculations and archive replay passed')
} else {
	console.log('OpenOracle pinned market fixture calculations passed; set OPEN_ORACLE_ARCHIVE_RPC_URL for the archive replay')
}
