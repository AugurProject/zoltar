import { afterAll, beforeAll, beforeEach, setDefaultTimeout } from 'bun:test'
import type { AnvilWindowEthereum } from './AnvilWindowEthereum'
import type { AnvilNode } from './anvilNode'
import { createAnvilNodeForConnectionMode, getAnvilConnectionMode } from './anvilNode'
import { ensureDefined } from './utils/testUtils'
const isSolidityBytecodeCoverageEnabled = (): boolean => process.env['SOLIDITY_BYTECODE_COVERAGE'] === '1'

const TEST_CHAIN_START_TIMESTAMP = 1n
export const TEST_TIMEOUT_MS = 300_000

setDefaultTimeout(TEST_TIMEOUT_MS)

export const useIsolatedAnvilNode = () => {
	let anvilNode: AnvilNode | undefined
	let anvilWindowEthereum: AnvilWindowEthereum | undefined
	let snapshotId: string | undefined

	beforeAll(async () => {
		const connectionMode = getAnvilConnectionMode()
		anvilNode = await createAnvilNodeForConnectionMode(connectionMode, {
			context: 'test file',
			printTraces: isSolidityBytecodeCoverageEnabled(),
			startTimestamp: TEST_CHAIN_START_TIMESTAMP,
		})
		anvilWindowEthereum = anvilNode.anvilWindowEthereum
		snapshotId = await anvilWindowEthereum.anvilSnapshot()
	})

	beforeEach(async () => {
		const currentEthereum = ensureDefined(anvilWindowEthereum, 'Isolated Anvil node was not initialized')
		const currentSnapshotId = ensureDefined(snapshotId, 'Missing Anvil snapshot for test isolation')
		try {
			await currentEthereum.anvilRevert(currentSnapshotId)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			if (!errorMessage.includes('Resource not found')) throw error
			await currentEthereum.resetToCleanState()
		}
		await currentEthereum.setNextBlockBaseFeePerGasToZero()
		snapshotId = await currentEthereum.anvilSnapshot()
	})

	afterAll(async () => {
		await anvilNode?.dispose()
		anvilNode = undefined
		anvilWindowEthereum = undefined
		snapshotId = undefined
	})

	return {
		getAnvilWindowEthereum: () => ensureDefined(anvilWindowEthereum, 'Isolated Anvil node was not initialized'),
		setBaselineSnapshot: async () => {
			const currentEthereum = ensureDefined(anvilWindowEthereum, 'Isolated Anvil node was not initialized')
			await currentEthereum.setNextBlockBaseFeePerGasToZero()
			snapshotId = await currentEthereum.anvilSnapshot()
		},
	}
}
