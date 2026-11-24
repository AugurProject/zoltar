import { test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from '../testSupport/simulator/utils/assert'
import { getContractOutput, loadContractsJson, normalizeStorageLayout } from './contractArtifactHelpers'

test('QuestionLedger stateful delegates retain the exact host storage sequence', () => {
	const artifacts = loadContractsJson(import.meta.dir)
	const hostLayout = normalizeStorageLayout(getContractOutput(artifacts, 'contracts/statoblast/QuestionLedger.sol', 'QuestionLedger'))
	const summarize = (layout: typeof hostLayout) =>
		layout.map(entry => ({
			label: entry.label,
			offset: entry.offset,
			slot: entry.slot,
			type: entry.type,
		}))
	for (const [sourcePath, contractName] of [
		['contracts/statoblast/QuestionLedgerEventEmitter.sol', 'QuestionLedgerEventEmitter'],
		['contracts/statoblast/QuestionLedgerSettlementDelegate.sol', 'QuestionLedgerSettlementDelegate'],
		['contracts/statoblast/QuestionLedgerOperationsDelegate.sol', 'QuestionLedgerOperationsDelegate'],
	] as const) {
		const delegateLayout = normalizeStorageLayout(getContractOutput(artifacts, sourcePath, contractName))
		assert.deepStrictEqual(summarize(delegateLayout), summarize(hostLayout), `${contractName} storage layout diverged`)
	}
})

test('QuestionLedger keeps low-level assembly outside the stateful host contract', () => {
	const questionLedgerSource = readFileSync(join(import.meta.dir, '../../contracts/statoblast/QuestionLedger.sol'), 'utf8')
	assert.strictEqual(questionLedgerSource.match(/\bassembly\b/), null)
})
