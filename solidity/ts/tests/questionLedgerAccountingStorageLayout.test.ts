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
		['contracts/statoblast/QuestionLedgerAccountingModule.sol', 'QuestionLedgerAccountingModule'],
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

test('deployment configuration encodes exactly the ledger constructor arguments', async () => {
	const { encodeAbiParameters } = await import('@zoltar/core-shared/evm/ethereum')
	const { statoblast_QuestionLedger_QuestionLedger: ledger, statoblast_factories_QuestionLedgerDeployer_QuestionLedgerDeployer: deployer } = await import('../types/contractArtifact')
	const ledgerConstructor = ledger.abi.find(item => item.type === 'constructor')
	if (ledgerConstructor === undefined) throw new Error('QuestionLedger constructor missing')
	const deploy = deployer.abi.find(item => item.type === 'function' && item.name === 'deploy')
	if (deploy === undefined) throw new Error('QuestionLedgerDeployer deploy missing')
	const configuration = {
		questionForker: '0x0000000000000000000000000000000000000001',
		questionData: '0x0000000000000000000000000000000000000002',
		escalationGameFactory: '0x0000000000000000000000000000000000000003',
		openOraclePriceCoordinator: '0x0000000000000000000000000000000000000004',
		shareToken: '0x0000000000000000000000000000000000000005',
		openOracle: '0x0000000000000000000000000000000000000006',
		parent: '0x0000000000000000000000000000000000000007',
		zoltar: '0x0000000000000000000000000000000000000008',
		universeId: 9n,
		questionId: 10n,
		statoblastSecurityMultiplierBps: 11n,
	} as const
	assert.strictEqual(
		encodeAbiParameters(deploy.inputs, [configuration]),
		encodeAbiParameters(ledgerConstructor.inputs, [
			configuration.questionForker,
			configuration.questionData,
			configuration.escalationGameFactory,
			configuration.openOraclePriceCoordinator,
			configuration.shareToken,
			configuration.openOracle,
			configuration.parent,
			configuration.zoltar,
			configuration.universeId,
			configuration.questionId,
			configuration.statoblastSecurityMultiplierBps,
		]),
	)
})
