import { readFile } from 'node:fs/promises'
import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { encodeDeployData, encodeFunctionData, type Address, type Hash, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import { privateKeyToAccount } from '@zoltar/shared/ethereum'
import { knownSourceMapCoverageGaps } from '../coverage/sourceMapCoverageGaps'
import {
	collectBytecodeCoverageForCall,
	collectBytecodeCoverageForTransaction,
	flushSolidityBytecodeCoverageForTest,
	getKnownSourceMapCoverageGapRuleMatchCountsForTest,
	getSolidityBytecodeCoverageProfileHitCountForTest,
	getSolidityCoverableLineNumbersForTest,
	resetSolidityBytecodeCoverageAddressCache,
	resolveTraceStepAddressesForTest,
} from '../coverage/traceToSource'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, applyLibraries } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import {
	DeploymentStatusOracle_DeploymentStatusOracle,
	peripherals_factories_EscalationGameFactory_EscalationGameFactory,
	peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory,
	peripherals_factories_SecurityPoolDeployer_SecurityPoolDeployer,
	peripherals_factories_SecurityPoolDeployer_SecurityPoolDeploymentWorker,
	ReputationToken_ReputationToken,
	test_peripherals_CoverageHelpersHarness_CoverageAttributionDecoy,
	test_peripherals_CoverageHelpersHarness_CoverageAttributionExecuted,
	test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness,
	test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness,
	test_peripherals_CoverageHelpersHarness_EscalationGameFactoryCoverageSecurityPool,
	test_peripherals_SecurityPoolConstructorFailureZoltar_SecurityPoolConstructorFailureZoltar,
} from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const SCALAR_DECIMALS = 18n
const ONE_REP = 10n ** 18n
const MAX_INT256 = 2n ** 255n - 1n
const MIN_INT256 = -(2n ** 255n)
const DEFAULT_ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

type CoverageFileSummary = {
	readonly file: string
	readonly lineHits: Record<string, number>
}

const bytes32 = (value: bigint): Hex => `0x${value.toString(16).padStart(64, '0')}` as Hex
const isCoverageEnabled = () => process.env['SOLIDITY_BYTECODE_COVERAGE'] === '1'
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const parseRpcQuantity = (value: unknown): bigint => {
	if (typeof value !== 'string') throw new Error('Expected RPC quantity string')
	return BigInt(value)
}

const parseRpcHash = (value: unknown): Hash => {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('Expected RPC transaction hash')
	return value as Hash
}

const readCoverageFileSummary = async (sourceSuffix: string): Promise<CoverageFileSummary> => {
	const rawSummary = await readFile('solidity/coverage/coverage-summary.json', 'utf8')
	const parsedSummary: unknown = JSON.parse(rawSummary)
	if (!isRecord(parsedSummary)) throw new Error('Coverage summary must be an object')
	const files = parsedSummary['files']
	if (!isRecord(files)) throw new Error('Coverage summary must contain files')
	for (const fileSummaryValue of Object.values(files)) {
		if (!isRecord(fileSummaryValue)) continue
		const file = fileSummaryValue['file']
		const lineHits = fileSummaryValue['lineHits']
		if (typeof file === 'string' && file.endsWith(sourceSuffix) && isRecord(lineHits)) {
			const parsedLineHits: Record<string, number> = {}
			for (const [line, hitCount] of Object.entries(lineHits)) {
				if (typeof hitCount !== 'number') throw new Error(`Coverage line ${line} has non-numeric hit count`)
				parsedLineHits[line] = hitCount
			}
			return { file, lineHits: parsedLineHits }
		}
	}
	throw new Error(`Coverage summary is missing ${sourceSuffix}`)
}

const normalizeRpcBytecode = (value: string): string => (value.startsWith('0x') ? value.slice(2) : value).toLowerCase()

const findLineNumberByExactSource = async (relativePath: string, sourceLine: string): Promise<number> => {
	const lines = (await readFile(relativePath, 'utf8')).split('\n')
	const lineIndex = lines.findIndex(line => line.trim() === sourceLine.trim())
	if (lineIndex === -1) throw new Error(`Unable to find source line '${sourceLine}' in ${relativePath}`)
	return lineIndex + 1
}

const readCoverageHitCount = async (sourceSuffix: string, lineNumber: number): Promise<number> => {
	const coverage = await readCoverageFileSummary(sourceSuffix)
	return coverage.lineHits[String(lineNumber)] ?? 0
}

test('coverage classifier keeps simple executable lines coverable so misses stay visible', () => {
	const source = ['contract CoverageClassifierRegression {', '    function branch(bool value) external pure returns (bool) {', '        bool observed = value;', '        if (observed) return true;', '        return false;', '    }', '}'].join('\n')

	assert.deepStrictEqual(getSolidityCoverableLineNumbersForTest('/tmp/CoverageClassifierRegression.sol', source), [3, 4, 5])
})

test('coverage classifier excludes declarations and scaffold-only lines from production totals', () => {
	const source = ['pragma solidity ^0.8.0;', 'contract CoverageClassifierScaffold {', '    event Observed(uint256 value);', '    uint256 public total;', '    function observe(uint256 value) external {', '        total = value;', '        emit Observed(value);', '    }', '}'].join('\n')

	assert.deepStrictEqual(getSolidityCoverableLineNumbersForTest('/tmp/CoverageClassifierScaffold.sol', source), [6, 7])
})

test('coverage classifier keeps side-effect-only call statements coverable', () => {
	const source = [
		'contract CoverageClassifierCalls {',
		'    function execute(address vault, uint256 amount) external {',
		'        token.safeTransfer(receiver, amount);',
		'        _syncActiveVault(vault);',
		'        burnRep(repToken, msg.sender, amount);',
		'        securityPool.configureVault(',
		'            vault,',
		'            amount',
		'        );',
		'    }',
		'}',
	].join('\n')

	assert.deepStrictEqual(getSolidityCoverableLineNumbersForTest('/tmp/CoverageClassifierCalls.sol', source), [3, 4, 5, 6])
})

test('coverage classifier keeps known untraceable source-map lines from manifest out of production totals', () => {
	const cases = [
		{
			sourcePath: '/tmp/solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol',
			source: ['contract SecurityPoolForkerVaultMigrationBase {', '    constructor() {', '        pool = _pool;', '    }', '}'],
		},
		{
			sourcePath: '/tmp/solidity/contracts/peripherals/tokens/ERC1155.sol',
			source: [
				'contract ERC1155 {',
				'    function balanceOfBatch() external returns (uint256[] memory) {',
				'        return balances;',
				'    }',
				'    function legacyTransfer(address sender, address recipient, uint256 tokenId, uint256 amount) internal {',
				"        _transferFrom(sender, recipient, tokenId, amount, '');",
				'    }',
				'}',
			],
		},
		{
			sourcePath: '/tmp/solidity/contracts/peripherals/EscalationGameSettlement.sol',
			source: ['contract EscalationGameSettlement {', '    function withdrawDeposit(', '        uint256 claimIndex,', '        BinaryOutcomes.BinaryOutcome selectedOutcome', '    ) public {', "        require(selectedOutcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');", '    }', '}'],
		},
		{
			sourcePath: '/tmp/solidity/contracts/peripherals/EscalationGameEscrow.sol',
			source: [
				'contract EscalationGameEscrow {',
				'    function claim(ForkedEscrowState storage state, uint256 principalToClaim) internal {',
				'        uint256 nextPrincipalClaimed = state.sourcePrincipalClaimed + principalToClaim;',
				'        state.sourcePrincipalClaimed = nextPrincipalClaimed;',
				'        state.childRepClaimed = nextRepClaimed;',
				'    }',
				'}',
			],
		},
		{
			sourcePath: '/tmp/solidity/contracts/peripherals/EscalationGameCarry.sol',
			source: [
				'contract EscalationGameCarry {',
				'    function verify(bytes32[] calldata proofSiblings, uint8 selectedOutcome, uint256 parentDepositIndex, uint256 amount) internal {',
				'        if (currentRoot != bytes32(0)) return currentRoot;',
				"        require(proofSiblings.length == NULLIFIER_DEPTH, 'Bad nullifier length');",
				'        bytes32 observedRoot = _getCurrentNullifierRoot(selectedOutcome);',
				"        require(emptyRoot == observedRoot, 'Bad nullifier proof');",
				'        if (amount > inheritedAmountToConsume) {',
				'        }',
				'    }',
				'}',
			],
		},
	]

	for (const { sourcePath, source } of cases) {
		assert.deepStrictEqual(getSolidityCoverableLineNumbersForTest(sourcePath, source.join('\n')), [], `${sourcePath} should exclude manifest-covered source-map gaps`)
	}
})

test('coverage source-map gap manifest stays aligned with current Solidity sources', async () => {
	for (const fileGap of knownSourceMapCoverageGaps) {
		const source = await readFile(fileGap.sourcePath, 'utf8')
		const expectedRuleMatchCounts = fileGap.lineRules.map(rule => rule.currentSourceMatches)
		assert.deepStrictEqual(getKnownSourceMapCoverageGapRuleMatchCountsForTest(fileGap.sourcePath, source), expectedRuleMatchCounts, `${fileGap.sourcePath} source-map gap manifest should match current source`)
	}
})

test('coverage classifier keeps similar lines coverable when source-map gap context does not match', () => {
	const settlementProofOverload = [
		'contract EscalationGameSettlement {',
		'    function exportUnresolvedDeposit(',
		'        CarriedDepositProof calldata proof,',
		'        BinaryOutcomes.BinaryOutcome selectedOutcome',
		'    ) public {',
		"        require(selectedOutcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');",
		'    }',
		'}',
	].join('\n')
	const settlementUnrelatedUintOverload = [
		'contract EscalationGameSettlement {',
		'    function validateAmount(',
		'        uint256 amount,',
		'        BinaryOutcomes.BinaryOutcome selectedOutcome',
		'    ) public {',
		"        require(selectedOutcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');",
		'    }',
		'}',
	].join('\n')
	const erc1155Return = ['contract ERC1155 {', '    function balanceOf(address account, uint256 id) public view returns (uint256) {', '        return _balances[id][account];', '    }', '}'].join('\n')

	assert.deepStrictEqual(getSolidityCoverableLineNumbersForTest('/tmp/solidity/contracts/peripherals/EscalationGameSettlement.sol', settlementProofOverload), [6])
	assert.deepStrictEqual(getSolidityCoverableLineNumbersForTest('/tmp/solidity/contracts/peripherals/EscalationGameSettlement.sol', settlementUnrelatedUintOverload), [6])
	assert.deepStrictEqual(getSolidityCoverableLineNumbersForTest('/tmp/solidity/contracts/peripherals/tokens/ERC1155.sol', erc1155Return), [3])
})

test('coverage trace resolution never attributes unresolved nested program counters to fallback contracts', () => {
	const rootAddress = '0x0000000000000000000000000000000000000011'
	const resolved = resolveTraceStepAddressesForTest(
		[
			{ depth: 1, op: 'PUSH1', pc: 0 },
			{ depth: 2, op: 'PUSH1', pc: 0 },
		],
		rootAddress,
	)

	assert.deepStrictEqual(resolved, [
		{ codeAddress: rootAddress, stepAddress: undefined },
		{ codeAddress: undefined, stepAddress: undefined },
	])
})

describe('Solidity bytecode coverage helpers', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let participantClient: WriteClient

	const deployContract = async (deploymentData: Hex): Promise<Address> => {
		const hash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined || contractAddress === null) throw new Error('deployment address missing')
		return contractAddress
	}

	const transact = async (to: Address, data: Hex) => {
		await writeContractAndWait(client, () => client.sendTransaction({ to, data }))
	}

	const deployCoverageHelper = async () =>
		await deployContract(
			encodeDeployData({
				abi: test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi,
				bytecode: `0x${test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.evm.bytecode.object}`,
			}),
		)

	const deployErc1155CoverageHelper = async () =>
		await deployContract(
			encodeDeployData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				bytecode: `0x${test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.evm.bytecode.object}`,
			}),
		)

	const deployReputationToken = async () =>
		await deployContract(
			encodeDeployData({
				abi: ReputationToken_ReputationToken.abi,
				bytecode: `0x${ReputationToken_ReputationToken.evm.bytecode.object}`,
				args: [client.account.address],
			}),
		)

	const deployDeploymentStatusOracle = async (deploymentAddresses: readonly Address[]) =>
		await deployContract(
			encodeDeployData({
				abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
				bytecode: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}`,
				args: [deploymentAddresses],
			}),
		)

	const deployEscalationGameFactorySecurityPool = async (reputationTokenAddress: Address) =>
		await deployContract(
			encodeDeployData({
				abi: test_peripherals_CoverageHelpersHarness_EscalationGameFactoryCoverageSecurityPool.abi,
				bytecode: `0x${test_peripherals_CoverageHelpersHarness_EscalationGameFactoryCoverageSecurityPool.evm.bytecode.object}`,
				args: [reputationTokenAddress],
			}),
		)

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		participantClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await setupTestAccounts(mockWindow)
	})

	test('production attribution ignores unresolved nested PCs shared by unexecuted contract profiles', async () => {
		if (!isCoverageEnabled()) return

		const executedAddress = await deployContract(
			encodeDeployData({
				abi: test_peripherals_CoverageHelpersHarness_CoverageAttributionExecuted.abi,
				bytecode: `0x${test_peripherals_CoverageHelpersHarness_CoverageAttributionExecuted.evm.bytecode.object}`,
			}),
		)
		const decoyAddress = await deployContract(
			encodeDeployData({
				abi: test_peripherals_CoverageHelpersHarness_CoverageAttributionDecoy.abi,
				bytecode: `0x${test_peripherals_CoverageHelpersHarness_CoverageAttributionDecoy.evm.bytecode.object}`,
			}),
		)
		const sourcePath = 'solidity/contracts/test/peripherals/CoverageHelpersHarness.sol'
		const decoyLine = await findLineNumberByExactSource(sourcePath, 'uint256 decoyValue = 23;')
		const fixtureSourceSuffix = 'contracts/test/peripherals/CoverageHelpersHarness.sol'
		const decoyBeforeExecution = await getSolidityBytecodeCoverageProfileHitCountForTest(fixtureSourceSuffix, decoyLine)
		const decoyData = encodeFunctionData({
			abi: test_peripherals_CoverageHelpersHarness_CoverageAttributionDecoy.abi,
			functionName: 'select',
			args: [true],
		})
		const decoyHash = await client.sendTransaction({ to: decoyAddress, data: decoyData })
		const decoyReceipt = await client.waitForTransactionReceipt({ hash: decoyHash })
		assert.strictEqual(decoyReceipt.status, 'success', 'decoy attribution fixture call should succeed')
		const rawDecoyTrace = await mockWindow.request({
			method: 'debug_traceTransaction',
			params: [decoyHash, { disableStack: false, disableMemory: true, disableStorage: true }],
		})
		if (!isRecord(rawDecoyTrace)) throw new Error('Decoy attribution fixture trace is missing')
		const decoyStructLogs = rawDecoyTrace['structLogs']
		if (!Array.isArray(decoyStructLogs)) throw new Error('Decoy attribution fixture trace is missing struct logs')
		await collectBytecodeCoverageForTransaction({
			request: mockWindow.request.bind(mockWindow),
			transactionHash: decoyHash,
			transaction: { to: decoyAddress, data: decoyData },
			receipt: { to: decoyAddress },
		})
		assert.ok((await getSolidityBytecodeCoverageProfileHitCountForTest(fixtureSourceSuffix, decoyLine)) > decoyBeforeExecution, 'the decoy trace PCs should map to the guarded decoy source line')

		const data = encodeFunctionData({
			abi: test_peripherals_CoverageHelpersHarness_CoverageAttributionExecuted.abi,
			functionName: 'select',
			args: [true],
		})
		const hash = await client.sendTransaction({ to: executedAddress, data })
		const receipt = await client.waitForTransactionReceipt({ hash })
		assert.strictEqual(receipt.status, 'success', 'executed attribution fixture call should succeed')
		const rawTrace = await mockWindow.request({
			method: 'debug_traceTransaction',
			params: [hash, { disableStack: false, disableMemory: true, disableStorage: true }],
		})
		if (!isRecord(rawTrace)) throw new Error('Attribution fixture trace is missing')
		const structLogs = rawTrace['structLogs']
		if (!Array.isArray(structLogs)) throw new Error('Attribution fixture trace is missing struct logs')
		const unresolvedNestedSteps = decoyStructLogs.flatMap(step => {
			if (!isRecord(step) || typeof step['pc'] !== 'number') return []
			return [{ depth: 3, op: 'PUSH1', pc: step['pc'] }]
		})
		assert.ok(unresolvedNestedSteps.length > 0, 'decoy attribution fixture should produce unresolved PCs')

		const executedLine = await findLineNumberByExactSource(sourcePath, 'uint256 executedValue = 11;')
		const unreachableLine = await findLineNumberByExactSource(sourcePath, 'uint256 unreachableDecoyValue = 29;')
		const executedBefore = await getSolidityBytecodeCoverageProfileHitCountForTest(fixtureSourceSuffix, executedLine)
		const decoyBefore = await getSolidityBytecodeCoverageProfileHitCountForTest(fixtureSourceSuffix, decoyLine)
		const unreachableBefore = await getSolidityBytecodeCoverageProfileHitCountForTest(fixtureSourceSuffix, unreachableLine)

		resetSolidityBytecodeCoverageAddressCache()
		const requestWithUnresolvedNestedSteps = async (args: { method: string; params?: unknown[] | undefined }): Promise<unknown> => {
			if (args.method === 'debug_traceTransaction') {
				return {
					...rawTrace,
					structLogs: [...structLogs, { address: decoyAddress, depth: 2, op: 'STOP' }, ...unresolvedNestedSteps],
				}
			}
			return await mockWindow.request(args)
		}
		await collectBytecodeCoverageForTransaction({
			request: requestWithUnresolvedNestedSteps,
			transactionHash: hash,
			transaction: { to: executedAddress, data },
			receipt: { to: executedAddress },
		})

		assert.ok((await getSolidityBytecodeCoverageProfileHitCountForTest(fixtureSourceSuffix, executedLine)) > executedBefore, 'the actual root contract should receive production-path coverage')
		assert.strictEqual(await getSolidityBytecodeCoverageProfileHitCountForTest(fixtureSourceSuffix, decoyLine), decoyBefore, 'unresolved nested PCs must not cover an unexecuted profile with overlapping program counters')
		assert.strictEqual(await getSolidityBytecodeCoverageProfileHitCountForTest(fixtureSourceSuffix, unreachableLine), unreachableBefore, 'the deliberately unreachable decoy line must remain uncovered')
	})

	test('attributes raw transaction deployment coverage using transaction input fetched by hash', async () => {
		const rawAccount = privateKeyToAccount(DEFAULT_ANVIL_PRIVATE_KEY)
		await mockWindow.setBalance(rawAccount.address, 10n ** 20n)
		const nonce = parseRpcQuantity(
			await mockWindow.request({
				method: 'eth_getTransactionCount',
				params: [rawAccount.address, 'latest'],
			}),
		)
		const deploymentData = encodeDeployData({
			abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
			bytecode: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}`,
			args: [[client.account.address]],
		})
		const serializedTransaction = await rawAccount.signTransaction({
			chainId: 1,
			data: deploymentData,
			gas: 1_000_000n,
			gasPrice: 0n,
			nonce: Number(nonce),
		})
		const hash = parseRpcHash(
			await mockWindow.request({
				method: 'eth_sendRawTransaction',
				params: [serializedTransaction],
			}),
		)
		const receipt = await client.waitForTransactionReceipt({ hash })
		assert.strictEqual(receipt.status, 'success', 'raw deployment transaction should succeed')
		assert.notStrictEqual(receipt.contractAddress, undefined, 'raw deployment should produce a contract address')

		if (isCoverageEnabled()) {
			await flushSolidityBytecodeCoverageForTest()
			const deploymentStatusCoverage = await readCoverageFileSummary('/solidity/contracts/DeploymentStatusOracle.sol')
			assert.ok((deploymentStatusCoverage.lineHits['14'] ?? 0) > 0, 'raw deployment coverage should attribute the constructor assignment using input fetched by transaction hash')
		}
	})

	test('traces deployment status, ERC20 metadata, and safe ERC20 success paths through transactions', async () => {
		const helperAddress = await deployCoverageHelper()
		const reputationTokenAddress = await deployReputationToken()
		const deploymentStatusOracleAddress = await deployDeploymentStatusOracle([client.account.address, reputationTokenAddress])

		await transact(
			deploymentStatusOracleAddress,
			encodeFunctionData({
				abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
				functionName: 'getDeploymentMask',
			}),
		)
		assert.strictEqual(
			await client.readContract({
				abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
				address: deploymentStatusOracleAddress,
				functionName: 'getDeploymentMask',
			}),
			2n,
			'only the deployed contract address should be set in the mask',
		)

		await transact(reputationTokenAddress, encodeFunctionData({ abi: ReputationToken_ReputationToken.abi, functionName: 'name' }))
		await transact(reputationTokenAddress, encodeFunctionData({ abi: ReputationToken_ReputationToken.abi, functionName: 'symbol' }))
		await transact(reputationTokenAddress, encodeFunctionData({ abi: ReputationToken_ReputationToken.abi, functionName: 'decimals' }))
		await transact(reputationTokenAddress, encodeFunctionData({ abi: ReputationToken_ReputationToken.abi, functionName: 'totalSupply' }))
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'balanceOf',
				args: [client.account.address],
			}),
		)

		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'setMaxTheoreticalSupply',
				args: [100n],
			}),
		)
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'mint',
				args: [helperAddress, 20n],
			}),
		)
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'mint',
				args: [client.account.address, 30n],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi,
				functionName: 'safeApproveToken',
				args: [reputationTokenAddress, participantClient.account.address, 7n],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi,
				functionName: 'safeTransferToken',
				args: [reputationTokenAddress, participantClient.account.address, 5n],
			}),
		)
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'approve',
				args: [helperAddress, 9n],
			}),
		)
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'allowance',
				args: [client.account.address, helperAddress],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi,
				functionName: 'safeTransferFromToken',
				args: [reputationTokenAddress, client.account.address, participantClient.account.address, 9n],
			}),
		)
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'burn',
				args: [client.account.address, 1n],
			}),
		)

		assert.strictEqual(
			await client.readContract({
				abi: ReputationToken_ReputationToken.abi,
				address: reputationTokenAddress,
				functionName: 'allowance',
				args: [helperAddress, participantClient.account.address],
			}),
			7n,
			'safeApprove should set an allowance owned by the helper',
		)
		assert.strictEqual(
			await client.readContract({
				abi: ReputationToken_ReputationToken.abi,
				address: reputationTokenAddress,
				functionName: 'balanceOf',
				args: [participantClient.account.address],
			}),
			14n,
			'safe transfers should deliver REP to the recipient',
		)
	})

	test('reputation token mint rejects supply growth beyond the theoretical cap', async () => {
		const reputationTokenAddress = await deployReputationToken()

		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'setMaxTheoreticalSupply',
				args: [10n],
			}),
		)
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'mint',
				args: [client.account.address, 9n],
			}),
		)

		await assert.rejects(
			transact(
				reputationTokenAddress,
				encodeFunctionData({
					abi: ReputationToken_ReputationToken.abi,
					functionName: 'mint',
					args: [client.account.address, 2n],
				}),
			),
			/Mint exceeds theoretical supply/i,
		)
	})

	test('reuses cached address profiles without repeated getCode lookups for the same deployed contract', async () => {
		if (!isCoverageEnabled()) return

		const helperAddress = await deployCoverageHelper()
		const data = encodeFunctionData({
			abi: test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi,
			functionName: 'getTokenId',
			args: [7n, 1],
		})
		const hash = await client.sendTransaction({ to: helperAddress, data })
		const receipt = await client.waitForTransactionReceipt({ hash })
		assert.strictEqual(receipt.status, 'success', 'manual coverage transaction should succeed')

		resetSolidityBytecodeCoverageAddressCache()
		let helperGetCodeRequests = 0
		const countingRequest = async (args: { method: string; params?: unknown[] | undefined }): Promise<unknown> => {
			if (args.method === 'eth_getCode' && Array.isArray(args.params) && typeof args.params[0] === 'string' && args.params[0].toLowerCase() === helperAddress.toLowerCase()) helperGetCodeRequests++
			return await mockWindow.request(args)
		}
		const collectManualCoverage = async (): Promise<void> => {
			await collectBytecodeCoverageForTransaction({
				request: countingRequest,
				transactionHash: hash,
				transaction: { to: helperAddress, data },
				receipt: { to: helperAddress },
			})
		}

		await collectManualCoverage()
		assert.strictEqual(helperGetCodeRequests, 1, 'first attribution should fetch deployed helper code once')
		await collectManualCoverage()
		assert.strictEqual(helperGetCodeRequests, 1, 'second attribution should reuse the cached helper coverage profile')
	})

	test('traces eth_call coverage using state override code instead of latest chain code', async () => {
		if (!isCoverageEnabled()) return

		const helperRuntimeBytecode = test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.evm?.deployedBytecode?.object
		if (helperRuntimeBytecode === undefined || helperRuntimeBytecode.length === 0) throw new Error('CoverageHelpersHarness deployed bytecode is unavailable')
		const overrideCode = helperRuntimeBytecode.startsWith('0x') ? helperRuntimeBytecode : `0x${helperRuntimeBytecode}`
		const overrideAddress = participantClient.account.address
		const targetLineNumber = await findLineNumberByExactSource('solidity/contracts/peripherals/tokens/TokenId.sol', '_tokenId := or(')
		const callData = encodeFunctionData({
			abi: test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi,
			functionName: 'getTokenId',
			args: [7n, 1],
		})

		await flushSolidityBytecodeCoverageForTest()
		const priorHitCount = await readCoverageHitCount('/solidity/contracts/peripherals/tokens/TokenId.sol', targetLineNumber)

		resetSolidityBytecodeCoverageAddressCache()
		let overrideAddressGetCodeRequests = 0
		const countingRequest = async (args: { method: string; params?: unknown[] | undefined }): Promise<unknown> => {
			if (args.method === 'eth_getCode' && Array.isArray(args.params) && args.params[0] === overrideAddress) overrideAddressGetCodeRequests++
			return await mockWindow.request(args)
		}

		await collectBytecodeCoverageForCall({
			request: countingRequest,
			transaction: { to: overrideAddress, data: callData },
			stateOverrides: {
				[overrideAddress]: {
					code: overrideCode,
				},
			},
		})

		await flushSolidityBytecodeCoverageForTest()
		const nextHitCount = await readCoverageHitCount('/solidity/contracts/peripherals/tokens/TokenId.sol', targetLineNumber)
		assert.strictEqual(overrideAddressGetCodeRequests, 0, 'state override code should avoid a latest eth_getCode lookup for the overridden address')
		assert.ok(nextHitCount > priorHitCount, 'state override-backed eth_call coverage should attribute the TokenId source line')
	})

	test('traces eth_call coverage using code from the requested historical block instead of latest', async () => {
		if (!isCoverageEnabled()) return

		const helperAddress = await deployCoverageHelper()
		const targetLineNumber = await findLineNumberByExactSource('solidity/contracts/peripherals/tokens/TokenId.sol', '_tokenId := or(')
		const callData = encodeFunctionData({
			abi: test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi,
			functionName: 'getTokenId',
			args: [9n, 2],
		})

		await mockWindow.request({ method: 'evm_mine', params: [] })
		const callBlockNumber = parseRpcQuantity(await mockWindow.request({ method: 'eth_blockNumber', params: [] }))
		const callBlockTag = `0x${callBlockNumber.toString(16)}`
		const historicalCode = await mockWindow.request({
			method: 'eth_getCode',
			params: [helperAddress, callBlockTag],
		})
		if (typeof historicalCode !== 'string' || normalizeRpcBytecode(historicalCode).length === 0) throw new Error('Historical helper code is unavailable')
		const trace = await mockWindow.request({
			method: 'debug_traceCall',
			params: [{ to: helperAddress, data: callData }, callBlockTag, { disableStack: false, disableMemory: true, disableStorage: true }],
		})
		const latestCode = '0x00'
		assert.notStrictEqual(normalizeRpcBytecode(latestCode), normalizeRpcBytecode(historicalCode), 'historical block coverage test requires the mocked latest code to differ from the historical helper bytecode')

		await flushSolidityBytecodeCoverageForTest()
		const priorHitCount = await readCoverageHitCount('/solidity/contracts/peripherals/tokens/TokenId.sol', targetLineNumber)

		resetSolidityBytecodeCoverageAddressCache()
		let helperCodeLookupBlockTag: unknown
		const countingRequest = async (args: { method: string; params?: unknown[] | undefined }): Promise<unknown> => {
			if (args.method === 'eth_getCode' && Array.isArray(args.params) && typeof args.params[0] === 'string' && args.params[0].toLowerCase() === helperAddress.toLowerCase()) {
				helperCodeLookupBlockTag = args.params[1]
				return args.params[1] === callBlockTag ? historicalCode : latestCode
			}
			if (args.method === 'debug_traceCall') return trace
			return await mockWindow.request(args)
		}

		await collectBytecodeCoverageForCall({
			request: countingRequest,
			transaction: { to: helperAddress, data: callData },
			blockNumberOrHash: callBlockTag,
		})

		await flushSolidityBytecodeCoverageForTest()
		const nextHitCount = await readCoverageHitCount('/solidity/contracts/peripherals/tokens/TokenId.sol', targetLineNumber)
		assert.strictEqual(helperCodeLookupBlockTag, callBlockTag, 'historical eth_call coverage should resolve bytecode at the original block selector')
		assert.ok(nextHitCount > priorHitCount, 'historical eth_call coverage should attribute the TokenId source line even when latest code differs')
	})

	test('traces ERC1155 legacy helper overloads and internal mint, transfer, and burn paths', async () => {
		const tokenAddress = await deployErc1155CoverageHelper()

		await transact(tokenAddress, encodeFunctionData({ abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi, functionName: 'supportsInterface', args: ['0xd9b67a26'] }))
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'mintOne',
				args: [client.account.address, 1n, 5n],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'mintMany',
				args: [client.account.address, [2n, 3n], [7n, 11n]],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'balanceOfBatch',
				args: [
					[client.account.address, client.account.address, client.account.address],
					[1n, 2n, 3n],
				],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'setApprovalForAll',
				args: [participantClient.account.address, true],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'isApprovedForAll',
				args: [client.account.address, participantClient.account.address],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'transferWithLegacyHelper',
				args: [client.account.address, participantClient.account.address, 1n, 2n],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'internalTransferWithLegacyHelper',
				args: [participantClient.account.address, client.account.address, 1n, 1n],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'batchTransferWithLegacyHelper',
				args: [client.account.address, participantClient.account.address, [2n, 3n], [2n, 3n]],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'internalBatchTransferWithLegacyHelper',
				args: [participantClient.account.address, client.account.address, [2n, 3n], [1n, 1n]],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'batchTransferWithLegacyHelper',
				args: [client.account.address, participantClient.account.address, [], []],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'burnOne',
				args: [client.account.address, 1n, 1n],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'burnMany',
				args: [client.account.address, [2n, 3n], [1n, 1n]],
			}),
		)

		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				address: tokenAddress,
				functionName: 'totalSupply',
				args: [1n],
			}),
			4n,
			'single burn should reduce token supply',
		)
	})

	test('traces pure production libraries through transaction-backed harness calls', async () => {
		const helperAddress = await deployCoverageHelper()
		const helperAbi = test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi
		const siblingHashes = Array.from({ length: 64 }, (_, index) => bytes32(BigInt(index + 1)))

		assert.strictEqual(
			await client.readContract({
				abi: helperAbi,
				address: helperAddress,
				functionName: 'getTokenId',
				args: [7n, 1],
			}),
			(7n << 8n) | 1n,
			'token ids should pack universe and outcome',
		)

		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'getTokenId', args: [7n, 1] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'getTokenIds', args: [7n, [0, 1, 2]] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'unpackTokenId', args: [(7n << 8n) | 1n] }))
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: helperAbi,
				functionName: 'hashLeaf',
				args: [client.account.address, 1, 11n, 22n, 33n, 44n],
			}),
		)
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'hashParent', args: [bytes32(1n), bytes32(2n)] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'bagPeaks', args: [[], 0n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'bagPeaks', args: [[bytes32(1n), bytes32(2n), bytes32(3n)], 3n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'computeEmptyNullifierRoot' }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'getCurrentCarryPeakForLeaf', args: [3n, 0n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'getCurrentCarryPeakForLeaf', args: [3n, 2n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'bagCarryPeakSamples', args: [ZERO_BYTES32, bytes32(2n), 0n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'bagCarryPeakSamples', args: [bytes32(1n), bytes32(2n), 3n] }))
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: helperAbi,
				functionName: 'computeMerkleMountainRangeRootFromProof',
				args: [bytes32(10n), 3n, 0n, 1n, [bytes32(11n), bytes32(12n)]],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: helperAbi,
				functionName: 'computeMerkleMountainRangeRootFromProof',
				args: [bytes32(10n), 3n, 1n, 1n, [bytes32(11n), bytes32(12n)]],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: helperAbi,
				functionName: 'computeNullifierRoot',
				args: [5n, siblingHashes, bytes32(99n)],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: helperAbi,
				functionName: 'getScalarOutcomeName',
				args: [[0n, 1000n], '', 1000n, -500n * 10n ** SCALAR_DECIMALS, 500n * 10n ** SCALAR_DECIMALS],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: helperAbi,
				functionName: 'getScalarOutcomeName',
				args: [[500n, 500n], 'km', 1000n, -500n * 10n ** SCALAR_DECIMALS, 500n * 10n ** SCALAR_DECIMALS],
			}),
		)
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'addInt256Uint256', args: [5n, 7n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'addInt256Uint256', args: [-5n, 7n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'addInt256Uint256', args: [-7n, 5n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'addInt256Uint256', args: [MIN_INT256, 0n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'absoluteInt256', args: [5n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'absoluteInt256', args: [-5n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'mulDiv', args: [6n, 7n, 3n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'mulDiv', args: [2n ** 200n, 2n ** 80n, 2n ** 100n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'intToDecimalString', args: [-1234000000000000000n, 18n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'intToDecimalString', args: [42n * 10n ** SCALAR_DECIMALS, 18n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'zeroPadLeft', args: ['7', 3n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'zeroPadLeft', args: ['1234', 3n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'uintToString', args: [0n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'uintToString', args: [12345n] }))

		assert.strictEqual(
			await client.readContract({
				abi: helperAbi,
				address: helperAddress,
				functionName: 'addInt256Uint256',
				args: [MAX_INT256, 0n],
			}),
			MAX_INT256,
			'scalar arithmetic wrapper should preserve max int when adding zero',
		)
	})

	test('traces factory deployment paths through transaction-backed calls', async () => {
		const reputationTokenAddress = await deployReputationToken()
		const escalationGameFactoryAddress = await deployContract(
			encodeDeployData({
				abi: peripherals_factories_EscalationGameFactory_EscalationGameFactory.abi,
				bytecode: `0x${peripherals_factories_EscalationGameFactory_EscalationGameFactory.evm.bytecode.object}`,
			}),
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.sendTransaction({
					to: escalationGameFactoryAddress,
					data: encodeFunctionData({
						abi: peripherals_factories_EscalationGameFactory_EscalationGameFactory.abi,
						functionName: 'deployEscalationGame',
						args: [ONE_REP, 2n * ONE_REP],
					}),
					gas: 10_000_000n,
				}),
			),
			/execution reverted|reverted with reason|returned no data/i,
		)
		const startedGamePoolAddress = await deployEscalationGameFactorySecurityPool(reputationTokenAddress)
		const forkedGamePoolAddress = await deployEscalationGameFactorySecurityPool(reputationTokenAddress)
		await transact(
			startedGamePoolAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_EscalationGameFactoryCoverageSecurityPool.abi,
				functionName: 'deployStartedGame',
				args: [escalationGameFactoryAddress, ONE_REP, 2n * ONE_REP],
			}),
		)
		await transact(
			forkedGamePoolAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_EscalationGameFactoryCoverageSecurityPool.abi,
				functionName: 'deployForkedGame',
				args: [escalationGameFactoryAddress, ONE_REP, 2n * ONE_REP, 0n],
			}),
		)
		await assert.rejects(
			transact(
				startedGamePoolAddress,
				encodeFunctionData({
					abi: test_peripherals_CoverageHelpersHarness_EscalationGameFactoryCoverageSecurityPool.abi,
					functionName: 'deployStartedGame',
					args: [escalationGameFactoryAddress, ONE_REP, 2n * ONE_REP],
				}),
			),
			/Escalation game deployment failed/,
		)

		const priceOracleFactoryAddress = await deployContract(
			encodeDeployData({
				abi: peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.abi,
				bytecode: applyLibraries(peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object),
				args: [zeroAddress, 100000n, 1000000, ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, 480, 0, 100000, 10000, 115, true, true, client.account.address, 100000n, 30000n, 1000n],
			}),
		)
		await transact(
			priceOracleFactoryAddress,
			encodeFunctionData({
				abi: peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.abi,
				functionName: 'deployPriceOracleManagerAndOperatorQueuer',
				args: [zeroAddress, reputationTokenAddress, ZERO_BYTES32],
			}),
		)

		const fakeZoltar = await deployContract(
			encodeDeployData({
				abi: test_peripherals_SecurityPoolConstructorFailureZoltar_SecurityPoolConstructorFailureZoltar.abi,
				bytecode: `0x${test_peripherals_SecurityPoolConstructorFailureZoltar_SecurityPoolConstructorFailureZoltar.evm.bytecode.object}`,
			}),
		)
		const deploymentWorkerAddress = await deployContract(
			encodeDeployData({
				abi: peripherals_factories_SecurityPoolDeployer_SecurityPoolDeploymentWorker.abi,
				bytecode: applyLibraries(peripherals_factories_SecurityPoolDeployer_SecurityPoolDeploymentWorker.evm.bytecode.object),
			}),
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.sendTransaction({
					to: deploymentWorkerAddress,
					data: encodeFunctionData({
						abi: peripherals_factories_SecurityPoolDeployer_SecurityPoolDeploymentWorker.abi,
						functionName: 'deploy',
						args: [zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, fakeZoltar, 0n, 0n, 2n, 1n, zeroAddress],
					}),
					gas: 10_000_000n,
				}),
			),
			/SafeERC20Ops token address must contain contract code/,
		)
		const securityPoolDeployerAddress = await deployContract(
			encodeDeployData({
				abi: peripherals_factories_SecurityPoolDeployer_SecurityPoolDeployer.abi,
				bytecode: applyLibraries(peripherals_factories_SecurityPoolDeployer_SecurityPoolDeployer.evm.bytecode.object),
			}),
		)
		await assert.rejects(
			writeContractAndWait(client, () =>
				client.sendTransaction({
					to: securityPoolDeployerAddress,
					data: encodeFunctionData({
						abi: peripherals_factories_SecurityPoolDeployer_SecurityPoolDeployer.abi,
						functionName: 'deploy',
						args: [zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, fakeZoltar, 0n, 0n, 2n, 1n, zeroAddress],
					}),
					gas: 10_000_000n,
				}),
			),
			/SafeERC20Ops token address must contain contract code/,
		)
	})
})
