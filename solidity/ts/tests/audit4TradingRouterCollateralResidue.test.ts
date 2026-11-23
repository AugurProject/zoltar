import { describe, expect, test } from 'bun:test'
import { encodeDeployData, type Abi, maxUint256 } from '@zoltar/core-shared/evm/ethereum'
import { encodeReceiveRequest } from '@zoltar/trading-shared/trading/receiveRequest'
import { deployContract } from '../testSupport/deployContract'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { forkUniverse, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { GENESIS_REPUTATION_TOKEN } from '../testSupport/simulator/utils/constants'
import {
	trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory as factoryArtifact,
	trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter as routerArtifact,
	trading_TwoWayConstantProductPair_TwoWayConstantProductPair as pairArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	statoblast_tokens_ShareToken_ShareToken as sharesArtifact,
} from '../types/contractArtifact'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

const erc20Abi = [
	{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
	{
		type: 'function',
		name: 'allowance',
		stateMutability: 'view',
		inputs: [
			{ name: 'owner', type: 'address' },
			{ name: 'spender', type: 'address' },
		],
		outputs: [{ type: 'uint256' }],
	},
] as const satisfies Abi

const zoltarForkAbi = [
	{ type: 'function', name: 'getForkRecapitalizationDeadline', stateMutability: 'view', inputs: [{ name: 'universeId', type: 'uint248' }], outputs: [{ type: 'uint256' }] },
	{
		type: 'function',
		name: 'getChildUniverseId',
		stateMutability: 'pure',
		inputs: [
			{ name: 'universeId', type: 'uint248' },
			{ name: 'outcomeIndex', type: 'uint256' },
		],
		outputs: [{ type: 'uint248' }],
	},
] as const satisfies Abi

// Audit pass 4: the router quotes the purchase fee itself, wraps `cash + fee`, and approves the security pool
// services for that amount. The services contract re-quotes inside the purchase. If the two quotes ever
// differed, wrapped collateral and an allowance would strand in the router, which has no sweep. The existing
// suite only asserts the router's native ETH balance, so this pins the wrapped-collateral side across fee accrual.
describe('audit4: router keeps no wrapped collateral or services allowance', () => {
	const fixture = useSecurityPoolFixture()

	test('entries, liquidity additions, and exits across irregular fee accrual leave the router empty', async () => {
		await fixture.prepare()
		const owner = fixture.owner()
		const account = owner.account.address
		const native = fixture.poolFor(fixture.base.questionId)
		const factory = await deployContract(owner, encodeDeployData({ abi: factoryArtifact.abi, bytecode: `0x${factoryArtifact.evm.bytecode.object}`, args: [getInfraContractAddresses().securityPoolFactory, 30n] }))
		const router = await deployContract(owner, encodeDeployData({ abi: routerArtifact.abi, bytecode: `0x${routerArtifact.evm.bytecode.object}`, args: [factory] }))
		const collateral = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		const services = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'services' })
		const deadline = fixture.base.questionData.endTime - 1n
		const universeId = fixture.base.genesisUniverse
		const ids = [universeId << 8n, (universeId << 8n) | 1n, (universeId << 8n) | 2n] as const
		const expectEmptyRouter = async () => {
			expect(await owner.getBalance({ address: router })).toBe(0n)
			expect(await owner.readContract({ abi: erc20Abi, address: collateral, functionName: 'balanceOf', args: [router] })).toBe(0n)
			expect(await owner.readContract({ abi: erc20Abi, address: collateral, functionName: 'allowance', args: [router, services] })).toBe(0n)
			for (const id of ids) expect(await owner.readContract({ abi: sharesArtifact.abi, address: native.shareToken, functionName: 'balanceOf', args: [router, id] })).toBe(0n)
		}
		const advance = async (seconds: bigint) => {
			await fixture.base.mockWindow.setTime((await fixture.base.mockWindow.getTime()) + seconds)
			// Minting capacity is zero while the oracle price is stale.
			await fixture.refreshPrice()
		}

		await writeContractAndWait(owner, () => owner.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'createPairAndInitializeWithEth', args: [native.questionLedger, unit, 6_300n, maxUint256, maxUint256, 0n, 0n, 1n, account, deadline], value: 2n * unit }))
		await expectEmptyRouter()
		const pair = await owner.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getPair', args: [native.questionLedger] })

		for (const [elapsed, cash] of [
			[17n, unit / 7n],
			[3_601n, unit / 5n + 1n],
			[86_399n, unit / 3n + 13n],
			[1n, 1_000_003n],
		] as const) {
			await advance(elapsed)
			const entry = { abi: routerArtifact.abi, address: router, functionName: 'enterPosition' as const, args: [pair, cash, 1, 1n, account, deadline] as const, value: 2n * cash + unit }
			const quote = await owner.simulateContract(entry)
			await writeContractAndWait(owner, () => owner.writeContract(entry))
			await expectEmptyRouter()

			await advance(elapsed + 5n)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'addLiquidityWithEth', args: [pair, cash, 2n ** 256n - 1n, 2n ** 256n - 1n, 1n, account, deadline], value: 2n * cash + unit }))
			await expectEmptyRouter()

			const exitAmount = quote.result.completeSetShares / 3n
			const exitData = encodeReceiveRequest([2, 0, native.shareToken, native.questionLedger, pair, universeId, fixture.base.questionId, ids[0], ids[1], ids[2], 1, exitAmount, quote.result.totalLongShares, 0n, account, account, deadline, 0n])
			await writeContractAndWait(owner, () => owner.writeContract({ abi: sharesArtifact.abi, address: native.shareToken, functionName: 'safeBatchTransferFrom', args: [account, router, [ids[0], ids[1]], [exitAmount, quote.result.totalLongShares], exitData] }))
			await expectEmptyRouter()
		}
	})
})

// Audit pass 4: the pair cannot call ShareToken.migrate, so LP claims on a forked universe survive only if
// withdrawn source shares stay transferable out of the pair and migratable by the LP afterwards.
describe('audit4: LP claims survive a universe fork', () => {
	const securityPool = useSecurityPoolFixture({ purchaseFeeBps: 0n, annualFeeBps: 0n, minimumPurchaseFeeAttoEth: 0n })
	const fixture = securityPool.base

	test('an LP withdraws source shares after the fork and materializes them in a child universe', async () => {
		await securityPool.prepare()
		const client = fixture.client
		const account = client.account.address
		const native = securityPool.poolFor(fixture.questionId)
		const factory = await deployContract(client, encodeDeployData({ abi: factoryArtifact.abi, bytecode: `0x${factoryArtifact.evm.bytecode.object}`, args: [getInfraContractAddresses().securityPoolFactory, 30n] }))
		const router = await deployContract(client, encodeDeployData({ abi: routerArtifact.abi, bytecode: `0x${routerArtifact.evm.bytecode.object}`, args: [factory] }))
		const deadline = fixture.questionData.endTime - 1n
		const amount = 1_000_000n
		await writeContractAndWait(client, () => client.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'createPairAndInitializeWithEth', args: [native.questionLedger, amount, 5_000n, maxUint256, maxUint256, 0n, 0n, 1n, account, deadline], value: amount }))
		const pair = await client.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getPair', args: [native.questionLedger] })
		const universeId = fixture.genesisUniverse
		const yesId = (universeId << 8n) | 1n
		const balance = async (owner: `0x${string}`, id: bigint) => await client.readContract({ abi: sharesArtifact.abi, address: native.shareToken, functionName: 'balanceOf', args: [owner, id] })

		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, universeId, fixture.questionId)
		expect(await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'tradingStatus' })).toBe(1n)

		const pairYesBefore = await balance(pair, yesId)
		const [yesReserve] = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' })
		expect(pairYesBefore).toBe(yesReserve)

		const accountYesBefore = await balance(account, yesId)
		const liquidity = await client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'balanceOf', args: [account] })
		await writeContractAndWait(client, () => client.writeContract({ abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 1n, 1n, account, 10n ** 12n] }))
		const withdrawnYes = (await balance(account, yesId)) - accountYesBefore
		expect(withdrawnYes).toBeGreaterThan(0n)
		// Only the 1,000-unit minimum-liquidity lock stays behind.
		expect(await balance(pair, yesId)).toBe(pairYesBefore - withdrawnYes)
		expect(await balance(pair, yesId)).toBeLessThanOrEqual(1_000n)

		const activationDeadline = await client.readContract({ abi: zoltarForkAbi, address: getZoltarAddress(), functionName: 'getForkRecapitalizationDeadline', args: [universeId] })
		await fixture.mockWindow.setTime(activationDeadline + 1n)
		// Prepare branch custody separately, as the production fork workflow does.
		const forks = await client.readContract({ abi: securityPoolArtifact.abi, address: securityPool.securityPool, functionName: 'forkController' })
		await writeContractAndWait(client, () => client.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'prepareBranch', args: [universeId, 1n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: sharesArtifact.abi, address: native.shareToken, functionName: 'migrate', args: [yesId, [1n]] }))
		const childUniverse = await client.readContract({ abi: zoltarForkAbi, address: getZoltarAddress(), functionName: 'getChildUniverseId', args: [universeId, 1n] })
		expect(await balance(account, (childUniverse << 8n) | 1n)).toBe(await balance(account, yesId))
	})
})
