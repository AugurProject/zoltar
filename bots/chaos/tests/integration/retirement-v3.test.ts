import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAnvilNodeForConnectionMode, type AnvilNode } from '../../../../solidity/ts/testSupport/simulator/anvilNode.ts'
import { createWriteClient } from '../../../../solidity/ts/testSupport/simulator/utils/clients.ts'
import { TEST_ADDRESSES } from '../../../../solidity/ts/testSupport/simulator/utils/constants.ts'
import { setupTestAccounts } from '../../../../solidity/ts/testSupport/simulator/utils/utilities.ts'
import { addressString } from '../../../../solidity/ts/testSupport/simulator/utils/bigint.ts'
import { buildAllowanceRevocationPlan, buildAssetSweepPlan, buildNativeOpenOracleCreditPlan } from '../../src/runtime/retirement-recovery-plans.ts'
import { buildV3RetirementPlan, readV3Position, readV3PositionsWithQuorum } from '../../src/runtime/retirement-v3-positions.ts'
import { DEFAULT_RETIREMENT_POLICIES, initialRetirementState, uniswapV3PositionKey, type DurableV3Position } from '../../src/state/retirement.ts'
import { recordV3ScanSuccess } from '../../src/runtime/retirement-v3-positions.ts'
import { loadDurableState, saveDurableState } from '../../src/state/operator-state.ts'
import { initialDurableState } from '../../src/state/initial-state.ts'
import { address, snapshotFixture } from '../operations/fixture.ts'
import { encodeDeployData, getAddress, type Abi, type Address, type Hex } from '@zoltar/bot-shared/ethereum'

const tokenAbi = [
	{
		inputs: [
			{ name: 'account', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		name: 'mint',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{ inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
	{
		inputs: [
			{ name: 'owner', type: 'address' },
			{ name: 'spender', type: 'address' },
		],
		name: 'allowance',
		outputs: [{ name: '', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		name: 'approve',
		outputs: [{ name: '', type: 'bool' }],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] as const
const poolAbi = [
	{
		inputs: [
			{ name: 'token0', type: 'address' },
			{ name: 'token1', type: 'address' },
		],
		stateMutability: 'nonpayable',
		type: 'constructor',
	},
	{
		inputs: [
			{ name: 'owner', type: 'address' },
			{ name: 'tickLower', type: 'int24' },
			{ name: 'tickUpper', type: 'int24' },
		],
		name: 'positionKey',
		outputs: [{ name: '', type: 'bytes32' }],
		stateMutability: 'pure',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'owner', type: 'address' },
			{ name: 'tickLower', type: 'int24' },
			{ name: 'tickUpper', type: 'int24' },
			{ name: 'liquidity', type: 'uint128' },
			{ name: 'tokensOwed0', type: 'uint128' },
			{ name: 'tokensOwed1', type: 'uint128' },
		],
		name: 'seed',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] as const
const openOracleAbi = [
	{
		inputs: [
			{ name: 'owner', type: 'address' },
			{ name: 'spender', type: 'address' },
			{ name: 'token', type: 'address' },
		],
		name: 'internalAllowance',
		outputs: [{ name: '', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'token', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		name: 'approveInternal',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{ inputs: [{ name: 'owner', type: 'address' }], name: 'creditNative', outputs: [], stateMutability: 'payable', type: 'function' },
	{
		inputs: [
			{ name: 'owner', type: 'address' },
			{ name: 'token', type: 'address' },
		],
		name: 'tokenHolder',
		outputs: [{ name: '', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const

let node: AnvilNode | undefined
let tokenBytecode: Hex
let poolBytecode: Hex
let openOracleBytecode: Hex
let compileDirectory: string | undefined

async function compileFixture() {
	compileDirectory = await mkdtemp(join(tmpdir(), 'chaos-retirement-solc-'))
	const source = new URL('../fixtures/RetirementV3Pool.sol', import.meta.url).pathname
	const solc = fileURLToPath(import.meta.resolve('solc/solc.js'))
	const process = Bun.spawn([solc, '--bin', '--optimize', '--output-dir', compileDirectory, source], { stderr: 'pipe', stdout: 'pipe' })
	const exitCode = await process.exited
	if (exitCode !== 0) throw new Error(`Retirement integration fixture compilation failed: ${await new Response(process.stderr).text()}`)
	const files = await readdir(compileDirectory)
	const readBytecode = async (suffix: string) => {
		const file = files.find(candidate => candidate.endsWith(suffix))
		if (file === undefined) throw new Error(`Compiled fixture omitted ${suffix}`)
		return `0x${(await readFile(join(compileDirectory ?? '', file), 'utf8')).trim()}` as Hex
	}
	tokenBytecode = await readBytecode('_RetirementTokenMock.bin')
	poolBytecode = await readBytecode('_RetirementV3PoolMock.bin')
	openOracleBytecode = await readBytecode('_RetirementOpenOracleMock.bin')
}

beforeAll(async () => {
	await compileFixture()
	node = await createAnvilNodeForConnectionMode({ port: 0, rpcUrl: '', type: 'spawn-isolated' }, { chainId: 31_337, context: 'chaos retirement integration', disableCodeSizeLimit: true, gasLimit: 30_000_000n })
	await setupTestAccounts(node.anvilWindowEthereum)
})

afterAll(async () => {
	await node?.dispose()
	if (compileDirectory !== undefined) await rm(compileDirectory, { force: true, recursive: true })
})

function requiredNode() {
	if (node === undefined) throw new Error('Retirement integration node was not initialized')
	return node
}

async function deploy(client: ReturnType<typeof createWriteClient>, bytecode: Hex, abi: Abi, args: readonly unknown[] = []) {
	const hash = await client.sendTransaction({ data: encodeDeployData({ abi, args, bytecode }) })
	const receipt = await client.waitForTransactionReceipt({ hash })
	if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Fixture deployment failed')
	return receipt.contractAddress
}

function durablePosition(pool: Address, owner: Address, token0: Address, token1: Address, id: string, tickLower = -120, tickUpper = 120): DurableV3Position {
	const positionKey = uniswapV3PositionKey(owner, tickLower, tickUpper)
	return { createdAt: new Date(0).toISOString(), creationWorkflowId: id, fee: 3_000, id: `${pool}:${positionKey}`, owner, pool, positionKey, profileId: 'integration', registeredBy: 'operator', status: 'active', tickLower, tickUpper, token0, token1 }
}

async function executePlan(client: ReturnType<typeof createWriteClient>, plan: ReturnType<typeof buildV3RetirementPlan>) {
	for (const step of plan.steps) await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: step.data, to: step.to, value: BigInt(step.value ?? '0') }) })
}

async function currentV3Anchor(client: ReturnType<typeof createWriteClient>) {
	const blockNumber = await client.getBlockNumber()
	const block = await client.getBlock({ blockNumber })
	if (block.hash === null || block.hash === undefined) throw new Error('Local-chain V3 test anchor has no block hash')
	return { blockHash: block.hash, blockNumber }
}

describe('Drain & Retire on a local chain', () => {
	test('recovers idempotently across pre-confirmation, post-confirmation, and burn-to-collect restarts', async () => {
		const simulator = requiredNode().anvilWindowEthereum
		const owner = createWriteClient(simulator, TEST_ADDRESSES[4], 4)
		const token0 = await deploy(owner, tokenBytecode, tokenAbi)
		const token1 = await deploy(owner, tokenBytecode, tokenAbi)
		const pool = await deploy(owner, poolBytecode, poolAbi, [token0, token1])
		for (const token of [token0, token1]) await owner.writeContract({ abi: tokenAbi, address: token, args: [pool, 10_000n], functionName: 'mint' })
		const directory = await mkdtemp(join(tmpdir(), 'chaos-retirement-v3-restart-'))
		const path = join(directory, 'state.json')
		try {
			const pending = { ...durablePosition(pool, owner.account.address, token0, token1, 'workflow:seed'), registeredBy: 'workflow' as const, status: 'pending-confirmation' as const }
			const durable = initialDurableState(31_337, false, 'integration', owner.account.address)
			durable.retirement.status = 'draining'
			durable.retirement.positions = [pending]
			await saveDurableState(path, durable)
			let restored = await loadDurableState(path, 31_337)
			const restoredPending = restored.retirement.positions[0]
			if (restoredPending === undefined) throw new Error('Pending V3 position was not restored')
			await expect(readV3Position(owner, restoredPending, await currentV3Anchor(owner))).rejects.toThrow('missing its canonical creation transaction')

			const creationTransactionHash = await owner.writeContract({ abi: poolAbi, address: pool, args: [owner.account.address, -120, 120, 70n, 3n, 4n], functionName: 'seed' })
			await owner.waitForTransactionReceipt({ hash: creationTransactionHash })
			restoredPending.creationTransactionHash = creationTransactionHash
			await saveDurableState(path, restored)
			restored = await loadDurableState(path, 31_337)
			const confirmed = restored.retirement.positions[0]
			if (confirmed === undefined) throw new Error('Confirmed V3 position was not restored')
			let observation = await readV3Position(owner, confirmed, await currentV3Anchor(owner))
			recordV3ScanSuccess(restored, observation, await owner.getBlockNumber())
			expect(confirmed.status).toBe('active')
			await saveDurableState(path, restored)

			const initialPlan = buildV3RetirementPlan(snapshotFixture(), observation, 1)
			const burn = initialPlan.steps[0]
			if (burn === undefined || burn.id !== 'burn-full-v3-position') throw new Error('Expected V3 burn step')
			await owner.waitForTransactionReceipt({ hash: await owner.sendTransaction({ data: burn.data, to: burn.to }) })

			restored = await loadDurableState(path, 31_337)
			const afterBurn = restored.retirement.positions[0]
			if (afterBurn === undefined) throw new Error('Burned V3 position was not restored')
			observation = await readV3Position(owner, afterBurn, await currentV3Anchor(owner))
			expect(observation).toMatchObject({ liquidity: 0n, tokensOwed0: 73n, tokensOwed1: 144n })
			const collectPlan = buildV3RetirementPlan(snapshotFixture(), observation, 2)
			expect(collectPlan.steps.map(step => step.id)).toEqual(['collect-full-v3-position'])
			await executePlan(owner, collectPlan)

			restored = await loadDurableState(path, 31_337)
			const afterCollectCrash = restored.retirement.positions[0]
			if (afterCollectCrash === undefined) throw new Error('Collected V3 position was not restored')
			const closed = await readV3Position(owner, afterCollectCrash, await currentV3Anchor(owner))
			expect(closed).toMatchObject({ liquidity: 0n, tokensOwed0: 0n, tokensOwed1: 0n })
			recordV3ScanSuccess(restored, closed, await owner.getBlockNumber())
			await saveDurableState(path, restored)
			const terminal = await loadDurableState(path, 31_337)
			expect(terminal.retirement.positions[0]?.status).toBe('closed')
			const terminalAnchor = await currentV3Anchor(owner)
			expect(await readV3PositionsWithQuorum([async (candidate, anchor) => await readV3Position(owner, candidate, anchor)], 1, terminal.retirement.positions, terminalAnchor)).toEqual([])
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('burns and collects exact current liquidity while leaving another wallet position untouched', async () => {
		const simulator = requiredNode().anvilWindowEthereum
		const owner = createWriteClient(simulator, TEST_ADDRESSES[0], 0)
		const other = createWriteClient(simulator, TEST_ADDRESSES[1], 1)
		const token0 = await deploy(owner, tokenBytecode, tokenAbi)
		const token1 = await deploy(owner, tokenBytecode, tokenAbi)
		const pool = await deploy(owner, poolBytecode, poolAbi, [token0, token1])
		for (const token of [token0, token1]) await owner.writeContract({ abi: tokenAbi, address: token, args: [pool, 10_000n], functionName: 'mint' })
		const creationTransactionHash = await owner.writeContract({ abi: poolAbi, address: pool, args: [owner.account.address, -120, 120, 70n, 3n, 4n], functionName: 'seed' })
		await owner.writeContract({ abi: poolAbi, address: pool, args: [owner.account.address, -60, 60, 20n, 1n, 2n], functionName: 'seed' })
		await owner.writeContract({ abi: poolAbi, address: pool, args: [other.account.address, -120, 120, 90n, 5n, 6n], functionName: 'seed' })
		const position = { ...durablePosition(pool, owner.account.address, token0, token1, 'owner'), creationTransactionHash, registeredBy: 'workflow' as const }
		const onChainKey = await owner.readContract({ abi: poolAbi, address: pool, args: [owner.account.address, -120, 120], functionName: 'positionKey' })
		expect(position.positionKey).toBe(onChainKey)
		const before = await readV3Position(owner, position, await currentV3Anchor(owner))
		expect(before).toMatchObject({ liquidity: 70n, tokensOwed0: 3n, tokensOwed1: 4n })
		await expect(readV3Position(owner, position, { blockHash: `0x${'ff'.repeat(32)}`, blockNumber: await owner.getBlockNumber() })).rejects.toThrow('does not match canonical anchor')
		await executePlan(owner, buildV3RetirementPlan(snapshotFixture(), before, 1))
		expect(await readV3Position(owner, position, await currentV3Anchor(owner))).toMatchObject({ liquidity: 0n, tokensOwed0: 0n, tokensOwed1: 0n })
		const secondPosition = durablePosition(pool, owner.account.address, token0, token1, 'owner-second', -60, 60)
		const secondBefore = await readV3Position(owner, secondPosition, await currentV3Anchor(owner))
		await executePlan(owner, buildV3RetirementPlan(snapshotFixture(), secondBefore, 1))
		expect(await readV3Position(owner, secondPosition, await currentV3Anchor(owner))).toMatchObject({ liquidity: 0n, tokensOwed0: 0n, tokensOwed1: 0n })
		expect(await owner.readContract({ abi: tokenAbi, address: token0, args: [owner.account.address], functionName: 'balanceOf' })).toBe(94n)
		expect(await owner.readContract({ abi: tokenAbi, address: token1, args: [owner.account.address], functionName: 'balanceOf' })).toBe(186n)
		const otherPosition = durablePosition(pool, other.account.address, token0, token1, 'other')
		expect(await readV3Position(owner, otherPosition, await currentV3Anchor(owner))).toMatchObject({ liquidity: 90n, tokensOwed0: 5n, tokensOwed1: 6n })
	})

	test('collects a zero-liquidity position, revokes allowance, and sweeps native ETH last with gas reserve', async () => {
		const simulator = requiredNode().anvilWindowEthereum
		const owner = createWriteClient(simulator, TEST_ADDRESSES[2], 2)
		const recipient = getAddress(addressString(TEST_ADDRESSES[3]))
		const token0 = await deploy(owner, tokenBytecode, tokenAbi)
		const token1 = await deploy(owner, tokenBytecode, tokenAbi)
		const pool = await deploy(owner, poolBytecode, poolAbi, [token0, token1])
		for (const token of [token0, token1]) await owner.writeContract({ abi: tokenAbi, address: token, args: [pool, 10_000n], functionName: 'mint' })
		await owner.writeContract({ abi: poolAbi, address: pool, args: [owner.account.address, -120, 120, 0n, 7n, 8n], functionName: 'seed' })
		const position = durablePosition(pool, owner.account.address, token0, token1, 'collect-only')
		const observation = await readV3Position(owner, position, await currentV3Anchor(owner))
		const plan = buildV3RetirementPlan(snapshotFixture(), observation, 2)
		expect(plan.steps.map(step => step.id)).toEqual(['collect-full-v3-position'])
		await executePlan(owner, plan)
		expect(await owner.readContract({ abi: tokenAbi, address: token0, args: [owner.account.address], functionName: 'balanceOf' })).toBe(7n)

		const spender = address(90)
		await owner.writeContract({ abi: tokenAbi, address: token0, args: [spender, 55n], functionName: 'approve' })
		const snapshot = snapshotFixture()
		snapshot.wallet.address = owner.account.address
		snapshot.wallet.tokens = [{ address: token0, allowances: { [spender]: '55' }, balance: '0', openOracleCredit: '0', symbol: 'MOCK' }]
		const revoke = buildAllowanceRevocationPlan(snapshot, 3)
		if (revoke === undefined) throw new Error('Allowance revocation was not planned')
		for (const step of revoke.steps) await owner.waitForTransactionReceipt({ hash: await owner.sendTransaction({ data: step.data, to: step.to }) })
		expect(await owner.readContract({ abi: tokenAbi, address: token0, args: [owner.account.address, spender], functionName: 'allowance' })).toBe(0n)

		const oracle = await deploy(owner, openOracleBytecode, openOracleAbi)
		await owner.writeContract({ abi: openOracleAbi, address: oracle, args: [owner.account.address, token0, 55n], functionName: 'approveInternal' })
		snapshot.deployments.openOracle = oracle
		snapshot.wallet.tokens = [{ address: token0, allowances: {}, balance: '0', openOracleCredit: '0', openOracleInternalAllowanceToSelf: '55', symbol: 'MOCK' }]
		const revokeInternal = buildAllowanceRevocationPlan(snapshot, 4)
		if (revokeInternal === undefined) throw new Error('Internal allowance revocation was not planned')
		for (const step of revokeInternal.steps) await owner.waitForTransactionReceipt({ hash: await owner.sendTransaction({ data: step.data, to: step.to }) })
		expect(await owner.readContract({ abi: openOracleAbi, address: oracle, args: [owner.account.address, owner.account.address, token0], functionName: 'internalAllowance' })).toBe(0n)

		await owner.writeContract({ abi: openOracleAbi, address: oracle, args: [owner.account.address], functionName: 'creditNative', value: 101n })
		snapshot.wallet.openOracleEthCredit = '101'
		const retirementWithRecipient = { ...initialRetirementState(), policies: { ...DEFAULT_RETIREMENT_POLICIES }, recipient, status: 'draining' as const }
		const creditPlan = buildNativeOpenOracleCreditPlan(snapshot, retirementWithRecipient, 5)
		if (creditPlan === undefined) throw new Error('Native OpenOracle credit withdrawal was not planned')
		const creditRecipientBefore = await owner.getBalance({ address: recipient })
		for (const step of creditPlan.steps) await owner.waitForTransactionReceipt({ hash: await owner.sendTransaction({ data: step.data, to: step.to }) })
		expect(await owner.readContract({ abi: openOracleAbi, address: oracle, args: [owner.account.address, address(0)], functionName: 'tokenHolder' })).toBe(1n)
		expect((await owner.getBalance({ address: recipient })) - creditRecipientBefore).toBe(100n)

		snapshot.wallet.tokens = []
		snapshot.wallet.ethBalanceAttoEth = (5n * 10n ** 18n).toString()
		const sweep = buildAssetSweepPlan(snapshot, retirementWithRecipient, 6, { maximumEthAttoEth: 10n ** 18n, maximumGasCostAttoEth: 2n * 10n ** 16n, maximumRepAttoRep: 10n ** 18n, minimumEthReserveAttoEth: 10n ** 18n })
		if (sweep === undefined) throw new Error('Native sweep was not planned')
		expect(sweep.definitionId).toBe('retirement.sweep.native-last')
		const recipientBefore = await owner.getBalance({ address: recipient })
		for (const step of sweep.steps) await owner.waitForTransactionReceipt({ hash: await owner.sendTransaction({ data: step.data, to: step.to, value: BigInt(step.value ?? '0') }) })
		expect((await owner.getBalance({ address: recipient })) - recipientBefore).toBe(10n ** 18n)
		expect(await owner.getBalance({ address: owner.account.address })).toBeGreaterThan(10n ** 18n)
	})

	test('never builds zero-address transfers or repeated self-sweeps on a local chain', async () => {
		const owner = createWriteClient(requiredNode().anvilWindowEthereum, TEST_ADDRESSES[2], 2)
		const snapshot = snapshotFixture()
		snapshot.wallet.address = owner.account.address
		snapshot.wallet.ethBalanceAttoEth = (2n * 10n ** 18n).toString()
		snapshot.wallet.openOracleEthCredit = '2'
		const before = await owner.getBalance({ address: owner.account.address })
		const limits = { maximumEthAttoEth: 10n ** 18n, maximumGasCostAttoEth: 1n, maximumRepAttoRep: 10n ** 18n, minimumEthReserveAttoEth: 1n }
		for (const [recipient, expectedError] of [
			[address(0), 'zero address'],
			[owner.account.address, 'durable signer'],
		] as const) {
			const retirement = { ...initialRetirementState(), recipient, status: 'draining' as const }
			expect(() => buildAssetSweepPlan(snapshot, retirement, 1, limits)).toThrow(expectedError)
			expect(() => buildAssetSweepPlan(snapshot, retirement, 2, limits)).toThrow(expectedError)
			expect(() => buildNativeOpenOracleCreditPlan(snapshot, retirement, 3)).toThrow(expectedError)
		}
		expect(await owner.getBalance({ address: owner.account.address })).toBe(before)
		expect(await owner.getBalance({ address: address(0) })).toBe(0n)
	})
})
