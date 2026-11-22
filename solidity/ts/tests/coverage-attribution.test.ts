import { encodeDeployData, encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { test } from 'bun:test'
import { getSolidityBytecodeCoverageConfig, isSolidityBytecodeCoverageEnabled } from '../testSupport/coverage/coverageConfig'
import { flushSolidityBytecodeCoverageForTest, getSoliditySourceLineRangeForTest } from '../testSupport/coverage/traceToSource'
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
