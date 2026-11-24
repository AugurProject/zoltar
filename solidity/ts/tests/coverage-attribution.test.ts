import { encodeDeployData, encodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'
import { test } from 'bun:test'
import solc from 'solc'
import { getContractOutput, getRecord, getString } from './contractArtifactHelpers'
import { getSolidityBytecodeCoverageConfig, isSolidityBytecodeCoverageEnabled } from '../testSupport/coverage/coverageConfig'
import { buildCoveragePcToSourceMapForTest, flushSolidityBytecodeCoverageForTest, getSolidityCoverableLineNumbersForTest, getSoliditySourceLineRangeForTest } from '../testSupport/coverage/traceToSource'
import { deployContract } from '../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import assert from '../testSupport/simulator/utils/assert'
import { createWriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { statoblast_Multicall3_Multicall3 as artifact } from '../types/contractArtifact'

test('resolves compiler byte offsets across Unicode comments and CRLF', () => {
	const prefix = '// café 🌱\r\n'
	const source = `${prefix}return 1;\r\nreturn 2;`
	assert.deepStrictEqual(getSoliditySourceLineRangeForTest(source, Buffer.byteLength(prefix), 9), { startLine: 2, endLine: 2 })
	assert.deepStrictEqual(getSoliditySourceLineRangeForTest(source, Buffer.byteLength(`${prefix}return 1;\r\n`), 9), { startLine: 3, endLine: 3 })
})

if (isSolidityBytecodeCoverageEnabled()) {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()

	test('UTF-8 compiler spans identify the same executed lines as ASCII spans (#1526)', async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		const client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const abi = parseAbi(['function select(bool first) pure returns (uint256)'])
		const sourcePath = 'OffsetFixture.sol'
		const body = ['contract OffsetFixture {', '    function select(bool first) external pure returns (uint256) {', '        if (first) {', '            return 777;', '        }', '        return 42;', '    }', '}'].join('\r\n')
		const executedLines = async (comment: string) => {
			const source = `// ${comment}\r\n${body}`
			const output = getRecord(
				JSON.parse(
					solc.compile(
						JSON.stringify({
							language: 'Solidity',
							sources: { [sourcePath]: { content: source } },
							settings: { outputSelection: { '*': { '*': ['evm.bytecode.object', 'evm.deployedBytecode'] } } },
						}),
					),
				),
				'Expected compiler output',
			)
			const contract = getContractOutput(output, sourcePath, 'OffsetFixture')
			const evm = getRecord(contract['evm'], 'Missing fixture bytecode')
			const runtime = getRecord(evm['deployedBytecode'], 'Missing fixture runtime bytecode')
			const creation = getRecord(evm['bytecode'], 'Missing fixture creation bytecode')
			const sources = getRecord(output['sources'], 'Missing compiler source IDs')
			const sourceId = getRecord(sources[sourcePath], 'Missing fixture source ID')['id']
			if (typeof sourceId !== 'number') throw new Error('Invalid fixture source ID')
			const pcMap = buildCoveragePcToSourceMapForTest(getString(runtime['object'], 'Missing runtime bytecode'), getString(runtime['sourceMap'], 'Missing runtime source map'), [])
			const address = await deployContract(client, encodeDeployData({ abi, bytecode: `0x${getString(creation['object'], 'Missing creation bytecode')}` }))
			assert.strictEqual(await client.readContract({ address, abi, functionName: 'select', args: [true] }), 777n)
			const hash = await writeContractAndWait(client, () => client.sendTransaction({ to: address, data: encodeFunctionData({ abi, functionName: 'select', args: [true] }) }))
			const trace = await ethereum.request({ method: 'debug_traceTransaction', params: [hash, { disableMemory: true, disableStack: true, disableStorage: true }] })
			if (!isPlainRecord(trace) || !Array.isArray(trace['structLogs'])) throw new Error('Missing coverage fixture trace')
			const inventory = getSolidityCoverableLineNumbersForTest(sourcePath, source)
			const hits = new Map<number, number>()
			for (const step of trace['structLogs']) {
				if (!isPlainRecord(step) || typeof step['pc'] !== 'number') throw new Error('Invalid coverage fixture step')
				const segment = pcMap.get(step['pc'])
				if (segment?.sourceIndex !== sourceId) continue
				const range = getSoliditySourceLineRangeForTest(source, segment.sourceOffset, segment.sourceLength)
				if (range === undefined || range.startLine !== range.endLine || !inventory.includes(range.startLine)) continue
				hits.set(range.startLine, (hits.get(range.startLine) ?? 0) + 1)
			}
			return { inventory, hits }
		}
		const ascii = await executedLines('x'.repeat(700))
		const unicode = await executedLines('é🌱'.repeat(350))
		assert.deepStrictEqual(unicode, ascii)
		assert.ok(ascii.hits.has(4), 'the executed branch condition must receive hits')
		assert.ok(ascii.inventory.includes(7) && !ascii.hits.has(7), 'the skipped return must remain uncovered')
	})

	test('deployment scaffolding does not cover unexecuted Multicall3 functions', async () => {
		const config = getSolidityBytecodeCoverageConfig()
		const source = 'solidity/contracts/statoblast/Multicall3.sol'
		const lines = (await Bun.file(source).text()).split('\n')
		const line = lines.findIndex(text => text.trim() === 'blockNumber = block.number;') + 1
		if (line === 0) throw new Error('Missing Multicall3 source location')
		const readHits = async () => {
			await flushSolidityBytecodeCoverageForTest()
			const file = Bun.file(config.summaryPath)
			if (!(await file.exists())) return 0
			const { files } = await file.json()
			return files[`${config.rootPath}/${source}`]?.lineHits[String(line)] ?? 0
		}
		const mockWindow = getAnvilWindowEthereum()
		await setupTestAccounts(mockWindow)
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
		const before = await readHits()
		const address = await deployContract(client, encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }))
		assert.strictEqual(await readHits(), before, 'creation cannot cover the runtime assignment')
		await writeContractAndWait(client, () => client.sendTransaction({ to: address, data: encodeFunctionData({ abi: artifact.abi, functionName: 'aggregate', args: [[]] }) }))
		assert.ok((await readHits()) > before, 'calling aggregate should cover its block assignment')
		// The coverage worker must publish this hit after the last explicit flush above.
		await writeContractAndWait(client, () => client.sendTransaction({ to: address, data: encodeFunctionData({ abi: artifact.abi, functionName: 'getChainId' }) }))
	})
}
