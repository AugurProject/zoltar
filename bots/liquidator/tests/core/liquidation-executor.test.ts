import { describe, expect, test } from 'bun:test'
import { parseSettings } from '#config/settings'
import { evaluateCandidate, PRICE_PRECISION, type VaultPosition } from '#core/strategy'
import { executeLiquidation, maintainVault } from '#execution/liquidation-executor'
import { initialRuntimeState, type PoolObservation, type StagedOperationObservation } from '#state/operator-state'
import { erc20Abi, securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'
import { createRpcEndpointPool, createWalletClient, decodeFunctionData, encodeAbiParameters, getAddress, isHex, privateKeyToAccount, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
const poolAddress = getAddress('0x0000000000000000000000000000000000000010')
const targetAddress = getAddress('0x0000000000000000000000000000000000000020')
const managerAddress = getAddress('0x0000000000000000000000000000000000000030')
const repToken = getAddress('0x0000000000000000000000000000000000000040')

function vault(address: typeof account.address, backingRep: bigint, limitEth: bigint): VaultPosition {
	return { address, backingUnits: backingRep * PRICE_PRECISION * PRICE_PRECISION, badDebtAttoEth: 0n, underwritingLimitAttoEth: limitEth * PRICE_PRECISION, claimableFeesAttoEth: 0n, disputeStakedAttoRep: 0n, openInterestAttoEth: limitEth * PRICE_PRECISION, vaultAttoRepBacking: backingRep * PRICE_PRECISION }
}

async function fixture() {
	const settings = parseSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	settings.strategy.maximumLiquidationDebtAttoEth = 10n * PRICE_PRECISION
	settings.strategy.maximumAttoRepPerPool = 550n * PRICE_PRECISION
	settings.strategy.maximumTotalDeployedRep = 550n * PRICE_PRECISION
	settings.strategy.minimumRewardValueAttoEth = 0n
	const target = vault(targetAddress, 500n, 100n)
	const pool: PoolObservation = {
		knownVaultCount: 2n,
		address: poolAddress,
		approvedUniverse: true,
		botVault: vault(account.address, 375n, 0n),
		candidates: [],
		settlementCollateralAttoEth: 0n,
		currentRetentionRate: 0n,
		forkActivationTime: 0n,
		forkOutcomeIndex: undefined,
		initialReportPriorityFeeAttoEthPerGas: 0n,
		isPriceValid: false,
		lastPrice: 10n * PRICE_PRECISION,
		lastSettlementTimestamp: 1n,
		manager: managerAddress,
		minLiquidationPriceDistanceBps: 100n,
		minimumSecurityBondDebtAttoEth: PRICE_PRECISION,
		minimumToken1ReportAttoEth: PRICE_PRECISION,
		minimumVaultRepDepositAttoRep: 30n * PRICE_PRECISION,
		multiplierBps: 20_000n,
		parent: zeroAddress,
		parentUniverseId: undefined,
		pendingReportId: 1n,
		pendingReportSponsor: account.address,
		questionId: 1n,
		repToken,
		requestPriceCostAttoEth: 0n,
		selected: true,
		securityPoolForker: zeroAddress,
		stagedOperations: [],
		systemState: 0n,
		totalUnderwritingLimitAttoEth: target.underwritingLimitAttoEth,
		totalAttoRep: 875n * PRICE_PRECISION,
		universeId: 0n,
		vaults: [target],
	}
	const candidate = evaluateCandidate({ ...pool, denominator: 875n * PRICE_PRECISION * PRICE_PRECISION, feeEligibleUnderwritingLimitAttoEth: pool.totalUnderwritingLimitAttoEth, price: pool.lastPrice }, target, pool.botVault, settings.strategy)
	if (candidate === undefined) throw new Error('Expected the partial liquidation candidate')
	pool.candidates = [candidate]
	const state = initialRuntimeState(false, account.address, settings.network.chainId)
	state.pools = [pool]
	const wallet = createWalletClient({
		account,
		chain: mainnet,
		transport: custom({
			request: async () => {
				throw new Error('Exposure rejection must precede wallet RPC')
			},
		}),
	})
	const rpcPool = new Proxy(createRpcEndpointPool([settings.connectivity.readRpcUrl]), {
		get(target, property) {
			if (property === 'transportFor')
				return () => {
					throw new Error('Exposure rejection must precede submission RPC')
				}
			return Reflect.get(target, property)
		},
	})
	return { candidate, pool, rpcPool, settings, state, wallet }
}

describe('liquidation exposure at the submission boundary', () => {
	for (const cap of ['pool', 'total'] as const) {
		test(`rounds candidate acquisition upward at a fractional backing ratio under the ${cap} cap`, async () => {
			const f = await fixture()
			f.pool.isPriceValid = true
			f.pool.botVault = vault(account.address, 750n, 0n)
			f.pool.totalAttoRep = 1_250n * PRICE_PRECISION + 1n
			f.settings.strategy.maximumLiquidationDebtAttoEth = 50n * PRICE_PRECISION
			f.settings.strategy.maximumAttoRepPerPool = (cap === 'pool' ? 1_250n : 10_000n) * PRICE_PRECISION
			f.settings.strategy.maximumTotalDeployedRep = (cap === 'total' ? 1_250n : 10_000n) * PRICE_PRECISION
			const target = vault(targetAddress, 500n, 50n)
			const candidate = evaluateCandidate({ ...f.candidate.pool, denominator: 1_250n * PRICE_PRECISION * PRICE_PRECISION, totalAttoRep: f.pool.totalAttoRep }, target, f.pool.botVault, f.settings.strategy)
			if (candidate === undefined) throw new Error('Expected the full-close rounding candidate')
			// The individually rounded balances sum to 1,250 REP, but combining all their backing units yields one more attoREP.
			expect(candidate.topUpAttoRep).toBe(0n)
			await expect(executeLiquidation(f.wallet, f.settings, f.state, f.rpcPool, f.pool, candidate, () => true)).rejects.toThrow(cap === 'pool' ? 'maximumPerPoolRep' : 'maximumTotalDeployedRep')
			expect(f.state.pendingTransactions).toHaveLength(0)
		})
	}

	test('allows a liquidation when its whole target acquisition exactly fits both caps', async () => {
		const f = await fixture()
		f.settings.strategy.maximumAttoRepPerPool = 875n * PRICE_PRECISION
		f.settings.strategy.maximumTotalDeployedRep = 875n * PRICE_PRECISION
		await expect(executeLiquidation(f.wallet, f.settings, f.state, f.rpcPool, f.pool, f.candidate, () => true)).rejects.toThrow('Exposure rejection must precede submission RPC')
	})

	for (const priceValid of [false, true]) {
		for (const cap of ['pool', 'total'] as const) {
			test(`reserves the whole target before ${priceValid ? 'fresh' : 'stale'} liquidation under the ${cap} cap`, async () => {
				const f = await fixture()
				f.pool.isPriceValid = priceValid
				if (cap === 'pool') f.settings.strategy.maximumTotalDeployedRep = 10_000n * PRICE_PRECISION
				else f.settings.strategy.maximumAttoRepPerPool = 10_000n * PRICE_PRECISION
				// A report at 30 REP/ETH awards 315 REP: the receiver stays healthy at 690 REP, above the 550 REP cap.
				expect(f.candidate.topUpAttoRep).toBe(0n)
				await expect(executeLiquidation(f.wallet, f.settings, f.state, f.rpcPool, f.pool, f.candidate, () => true)).rejects.toThrow(cap === 'pool' ? 'maximumPerPoolRep' : 'maximumTotalDeployedRep')
				expect(f.state.pendingTransactions).toHaveLength(0)
			})
		}
	}

	for (const fractionalRatio of [false, true]) {
		for (const pendingSettlement of [false, true]) {
			test(`retains full staged acquisition exposure during maintenance (pending settlement=${pendingSettlement}, fractional ratio=${fractionalRatio})`, async () => {
				const f = await fixture()
				f.settings.strategy.maximumAttoRepPerPool = (fractionalRatio ? 1_000n : 700n) * PRICE_PRECISION
				f.settings.strategy.maximumTotalDeployedRep = 10_000n * PRICE_PRECISION
				f.pool.botVault.underwritingLimitAttoEth = 20n * PRICE_PRECISION
				f.pool.totalAttoRep += fractionalRatio ? 1n : 0n
				const operation: StagedOperationObservation = {
					operationValue: f.candidate.requestedDebtAttoEth,
					id: 1n,
					liquidationApprovalId: `0x${'00'.repeat(32)}`,
					isPendingSettlement: pendingSettlement,
					operation: 0n,
					operator: account.address,
					queuedAt: 1n,
					receiverVault: account.address,
					reservedLiquidationDebtAttoEth: 0n,
					snapshotTotalRepBackingUnits: 875n * PRICE_PRECISION * PRICE_PRECISION,
					snapshotTargetUnderwritingLimitAttoEth: 100n * PRICE_PRECISION,
					snapshotTargetDisputeStakedAttoRep: 0n,
					snapshotTargetOpenInterestAttoEth: 0n,
					snapshotTargetBackingUnits: 500n * PRICE_PRECISION * PRICE_PRECISION,
					snapshotTotalPoolHeldAttoRep: f.pool.totalAttoRep,
					targetVault: targetAddress,
					validForSeconds: 240n,
				}
				f.pool.stagedOperations = [operation]
				await expect(maintainVault(f.wallet, f.settings, f.state, f.rpcPool, f.pool, () => true)).rejects.toThrow('maximumPerPoolRep')
				expect(f.state.pendingTransactions).toHaveLength(0)
			})
		}
	}
})

test('maintenance submits a backing deposit valid for the pool multiplier, independently of the health target', async () => {
	const f = await fixture()
	const directory = await mkdtemp(join(tmpdir(), 'liquidator-maintenance-'))
	f.settings.runtime.stateFile = join(directory, 'state.json')
	f.pool.isPriceValid = true
	f.pool.lastPrice = PRICE_PRECISION
	f.pool.botVault.underwritingLimitAttoEth = 100n * PRICE_PRECISION
	f.pool.botVault.vaultAttoRepBacking = 200n * PRICE_PRECISION
	const depositTargets: bigint[] = []
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			const payload = await request.json()
			const id = Reflect.get(payload, 'id')
			const method = Reflect.get(payload, 'method')
			let result: unknown
			if (method === 'eth_getBlockByNumber') result = { number: '0x64', hash: `0x${'11'.repeat(32)}`, baseFeePerGas: '0x1', timestamp: '0x1', transactions: [] }
			else if (method === 'eth_getTransactionCount') result = '0x0'
			else if (method === 'eth_call') {
				const data: unknown = Reflect.get(payload, 'params')?.[0]?.data
				if (typeof data !== 'string' || !isHex(data)) throw new Error('Test contract call has no calldata')
				const calldata: `0x${string}` = `0x${data.slice(2)}`
				const to = Reflect.get(payload, 'params')?.[0]?.to
				if (typeof to !== 'string') throw new Error('Test contract call has no target')
				if (to.toLowerCase() === repToken.toLowerCase()) {
					const decoded = decodeFunctionData({ abi: erc20Abi, data: calldata })
					if (decoded.functionName !== 'balanceOf' && decoded.functionName !== 'allowance') throw new Error('Unexpected token call')
					result = encodeAbiParameters([{ type: 'uint256' }], [2n ** 256n - 1n])
				} else {
					const decoded = decodeFunctionData({ abi: securityPoolAbi, data: calldata })
					if (decoded.functionName !== 'depositRepToVault') throw new Error('Unexpected pool call')
					const [amount, target] = decoded.args
					if (amount !== 50n * PRICE_PRECISION) throw new Error('Unexpected maintenance deposit amount')
					depositTargets.push(target)
					// The real contract enforces this boundary in _prepareRepDeposit; its existing on-chain test also exercises it.
					if (target < f.pool.multiplierBps) return Response.json({ id, jsonrpc: '2.0', error: { code: -32000, message: 'Target below pool minimum' } })
					result = '0x'
				}
			} else throw new Error(`Unexpected maintenance RPC: ${String(method)}`)
			return Response.json({ id, jsonrpc: '2.0', result })
		},
	})
	f.settings.connectivity = { readRpcUrl: server.url.toString(), quorumRpcUrls: [], publicRpcUrls: [], rpcQuorum: 1 }
	const rpcPool = createRpcEndpointPool([server.url.toString()])
	let marketChecks = 0
	try {
		await expect(
			maintainVault(f.wallet, f.settings, f.state, rpcPool, f.pool, () => {
				if (++marketChecks > 1) throw new Error('Stop after valid deposit simulation')
				return true
			}),
		).rejects.toThrow('Stop after valid deposit simulation')
		expect(depositTargets).toHaveLength(1)
		expect(depositTargets[0]).toBeGreaterThanOrEqual(f.pool.multiplierBps)
		expect(f.state.pendingTransactions).toHaveLength(0)
	} finally {
		server.stop(true)
		await rm(directory, { recursive: true, force: true })
	}
})
