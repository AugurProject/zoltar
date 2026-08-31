import { expect, test } from 'bun:test'
import { createPublicClient, custom, mainnet } from '@zoltar/bot-shared/ethereum'
import { parseSettings } from '#config/settings'
import { isUnsafeVault, PRICE_PRECISION, type VaultPosition } from '#core/strategy'
import { createPoolMonitorIndex, currentVaultPositionForPoolAccounting, loadChangedVaultAddresses, resolveOperatorVault, scanPools } from '#monitoring/pool-monitor'
import { createVaultStateIndex, refreshVaultStateIndex } from '#monitoring/vault-state-index'
import { getAddress } from '../helpers/ethereum.ts'

const vault = getAddress('0x0000000000000000000000000000000000000001')
const escrowVault = getAddress('0x0000000000000000000000000000000000000002')

test('binds the complete pool scan to one canonical block', async () => {
	const settings = parseSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	const previousBlockHash: `0x${string}` = `0x${'11'.repeat(32)}`
	const blockHash: `0x${string}` = `0x${'22'.repeat(32)}`
	const reorgedBlockHash: `0x${string}` = `0x${'33'.repeat(32)}`
	const pool = getAddress('0x0000000000000000000000000000000000000010')
	const manager = getAddress('0x0000000000000000000000000000000000000020')
	const forker = getAddress('0x0000000000000000000000000000000000000030')
	const repToken = getAddress('0x0000000000000000000000000000000000000040')
	const operator = getAddress('0x0000000000000000000000000000000000000050')
	settings.selectedPools = [pool]
	const contractReads: Array<{ blockNumber?: bigint; functionName: string }> = []
	const multicalls: Array<{ blockNumber?: bigint }> = []
	const logReads: Array<{ event?: { name?: string }; fromBlock?: bigint; toBlock?: bigint }> = []
	let reorgSnapshot = false
	const networkClient = createPublicClient({
		chain: mainnet,
		transport: custom({
			request: parameters => {
				if (parameters.method === 'eth_getBlockByNumber') {
					if (!Array.isArray(parameters.params)) throw new Error('Block request parameters are missing')
					const blockTag = parameters.params[0]
					if (blockTag === '0x1') return Promise.resolve({ hash: previousBlockHash, number: '0x1', parentHash: `0x${'00'.repeat(32)}`, timestamp: '0x1', transactions: [] })
					if (blockTag === 'latest' || blockTag === '0x2') return Promise.resolve({ hash: blockTag === '0x2' && reorgSnapshot ? reorgedBlockHash : blockHash, number: '0x2', parentHash: previousBlockHash, timestamp: '0x2', transactions: [] })
					throw new Error(`Unexpected block tag: ${String(blockTag)}`)
				}
				throw new Error(`Unexpected RPC method: ${parameters.method}`)
			},
		}),
	})
	const client = new Proxy(networkClient, {
		get(target, property) {
			if (property === 'getLogs') {
				return (parameters: { args?: { securityPool?: string }; event?: { name?: string }; fromBlock?: bigint; toBlock?: bigint }) => {
					logReads.push(parameters)
					if (parameters.event?.name === 'DeploySecurityPool') {
						if (parameters.args?.securityPool === undefined) return Promise.resolve([])
						return Promise.resolve([
							{
								args: {
									currentRetentionRate: 1n,
									initialReportPriorityFeeAttoEthPerGas: 1n,
									parent: getAddress('0x0000000000000000000000000000000000000000'),
									priceOracleManagerAndOperatorQueuer: manager,
									questionId: 1n,
									securityPool: pool,
									settlementCollateralAttoEth: 10n,
									statoblastSecurityMultiplierBps: 10_000n,
									universeId: 0n,
								},
							},
						])
					}
					if (parameters.event?.name === 'VaultAccountingCheckpoint') return Promise.resolve([{ args: { vault: operator } }])
					throw new Error(`Unexpected log read: ${parameters.event?.name ?? 'unknown event'}`)
				}
			}
			if (property === 'multicall') {
				return (parameters: { blockNumber?: bigint; contracts: Array<{ functionName: string }> }) => {
					multicalls.push(parameters)
					return Promise.resolve(
						parameters.contracts.map(contract => {
							if (contract.functionName === 'securityVaults') return [1n, 1n, 0n, 0n]
							if (contract.functionName === 'vaultBadDebtAttoEth') return 0n
							throw new Error(`Unexpected multicall read: ${contract.functionName}`)
						}),
					)
				}
			}
			if (property === 'readContract') {
				return (parameters: { blockNumber?: bigint; functionName: string }) => {
					contractReads.push(parameters)
					if (parameters.functionName === 'universes') {
						return Promise.resolve({ forkQuestionId: 0n, forkTime: 0n, forkingOutcomeIndex: 0n, parentUniverseId: 0n, reputationToken: repToken })
					}
					if (parameters.functionName === 'getDeployedChildUniverses') return Promise.resolve([[], [], []])
					if (parameters.functionName === 'getVaultCount') return Promise.resolve(1n)
					if (parameters.functionName === 'currentRetentionRate') return Promise.resolve(1n)
					if (parameters.functionName === 'totalRepBackingUnits') return Promise.resolve(1n)
					if (parameters.functionName === 'escalationGame') return Promise.resolve(getAddress('0x0000000000000000000000000000000000000000'))
					if (parameters.functionName === 'isPriceValid') return Promise.resolve(true)
					if (parameters.functionName === 'lastPrice') return Promise.resolve(1n)
					if (parameters.functionName === 'lastSettlementTimestamp') return Promise.resolve(1n)
					if (parameters.functionName === 'minLiquidationPriceDistanceBps') return Promise.resolve(1n)
					if (parameters.functionName === 'minimumSecurityBondDebtAttoEth') return Promise.resolve(1n)
					if (parameters.functionName === 'minimumToken1ReportAttoEth') return Promise.resolve(1n)
					if (parameters.functionName === 'minimumVaultRepDepositAttoRep') return Promise.resolve(1n)
					if (parameters.functionName === 'getPoolAccountingSnapshot') {
						return Promise.resolve({ feeEligibleCapacityOwnershipAttoRep: 1n, settlementCollateralAttoEth: 10n, totalCapacityOwnershipAttoRep: 1n })
					}
					if (parameters.functionName === 'pendingReportId') return Promise.resolve(0n)
					if (parameters.functionName === 'pendingReportSponsor') return Promise.resolve(getAddress('0x0000000000000000000000000000000000000000'))
					if (parameters.functionName === 'repToken') return Promise.resolve(repToken)
					if (parameters.functionName === 'getRequestPriceCostAttoEth') return Promise.resolve(1n)
					if (parameters.functionName === 'securityPoolForker') return Promise.resolve(forker)
					if (parameters.functionName === 'systemState') return Promise.resolve(0n)
					if (parameters.functionName === 'getTotalPoolHeldAttoRep') return Promise.resolve(1n)
					if (parameters.functionName === 'forkData') return Promise.resolve([0n, getAddress('0x0000000000000000000000000000000000000000'), 0n, 0n, 0n, 0n, 0n, 0n, false, false, 0n])
					if (parameters.functionName === 'getForkActivationTime') return Promise.resolve(0n)
					if (parameters.functionName === 'getActiveStagedOperationCount') return Promise.resolve(0n)
					if (parameters.functionName === 'getPendingSettlementOperationIds') return Promise.resolve([])
					if (parameters.functionName === 'balanceOf') return Promise.resolve(5n)
					throw new Error(`Unexpected contract read: ${parameters.functionName}`)
				}
			}
			return Reflect.get(target, property, target)
		},
	})
	const monitorIndex = createPoolMonitorIndex()
	const vaultIndex = createVaultStateIndex<VaultPosition>()
	vaultIndex.blockHash = previousBlockHash
	vaultIndex.blockNumber = 1n
	vaultIndex.knownVaultCount = 1n
	monitorIndex.vaultsByPool.set(pool.toLowerCase(), vaultIndex)

	const snapshot = await scanPools(client, settings, operator, monitorIndex)

	expect(snapshot.block).toEqual({ hash: blockHash, number: 2n, timestamp: 2n })
	expect(snapshot.walletRepByToken.get(repToken.toLowerCase())).toBe(5n)
	expect(contractReads.length).toBeGreaterThan(20)
	expect(contractReads.every(read => read.blockNumber === 2n)).toBeTrue()
	expect(multicalls.length).toBe(2)
	expect(multicalls.every(read => read.blockNumber === 2n)).toBeTrue()
	expect(logReads.find(read => read.event?.name === 'DeploySecurityPool')).toMatchObject({ fromBlock: 0n, toBlock: 2n })
	expect(logReads.find(read => read.event?.name === 'VaultAccountingCheckpoint')).toMatchObject({ fromBlock: 2n, toBlock: 2n })

	settings.selectedPools = []
	reorgSnapshot = true
	await expect(scanPools(client, settings, undefined)).rejects.toThrow('Security pool snapshot changed during discovery')
})

test('vault checkpoint catch-up adapts long cursor gaps into bounded ordered ranges', async () => {
	const completedRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = []
	const addresses = await loadChangedVaultAddresses(0n, 20_000n, [
		async range => {
			if (range.toBlock - range.fromBlock + 1n > 2_500n) throw new Error('block range is too large')
			completedRanges.push(range)
			return range.fromBlock === 0n ? [{ args: { vault } }] : []
		},
	])

	expect(addresses).toEqual([vault])
	expect(completedRanges[0]?.fromBlock).toBe(0n)
	expect(completedRanges.at(-1)?.toBlock).toBe(20_000n)
	for (let index = 1; index < completedRanges.length; index++) {
		expect(completedRanges[index]?.fromBlock).toBe((completedRanges[index - 1]?.toBlock ?? -1n) + 1n)
	}
})

test('vault change discovery includes pool checkpoints and escalation escrow updates', async () => {
	const addresses = await loadChangedVaultAddresses(10n, 10n, [async () => [{ args: { vault } }], async () => [{ args: { vault: escrowVault } }]])
	expect(addresses).toEqual([vault, escrowVault])
})

test('a truth-auction haircut globally dirties every retained dispute-staked vault', async () => {
	const backing = (15n * PRICE_PRECISION) / 10n
	const initialStake = PRICE_PRECISION / 2n
	const haircuttedStake = (2n * PRICE_PRECISION) / 5n
	const position = (address: typeof vault, disputeStakedAttoRep: bigint): VaultPosition => ({
		address,
		backingUnits: backing,
		badDebtAttoEth: 0n,
		capacityOwnershipAttoRep: PRICE_PRECISION,
		claimableFeesAttoEth: 0n,
		disputeStakedAttoRep,
		openInterestAttoEth: PRICE_PRECISION,
		vaultAttoRepBacking: backing,
	})
	const positions = new Map([
		[vault.toLowerCase(), position(vault, initialStake)],
		[escrowVault.toLowerCase(), position(escrowVault, initialStake)],
	])
	const index = createVaultStateIndex<VaultPosition>()
	const loadPositions = async (addresses: readonly (typeof vault)[]) => addresses.map(address => positions.get(address.toLowerCase()) ?? position(address, 0n))
	const first = await refreshVaultStateIndex(index, {
		block: { hash: `0x${'11'.repeat(32)}`, number: 9n },
		hasRep: candidate => candidate.backingUnits > 0n || candidate.disputeStakedAttoRep > 0n,
		knownVaultCount: 2n,
		loadChangedVaultAddresses: async () => [],
		loadPositions,
		loadRegistryRange: async () => [vault, escrowVault],
		readCanonicalBlockHash: async () => `0x${'11'.repeat(32)}`,
	})
	expect(first.activeVaults.every(candidate => !isUnsafeVault(candidate.vaultAttoRepBacking, candidate.openInterestAttoEth, 20_000n, PRICE_PRECISION, candidate.disputeStakedAttoRep))).toBeTrue()
	positions.set(vault.toLowerCase(), position(vault, haircuttedStake))
	positions.set(escrowVault.toLowerCase(), position(escrowVault, haircuttedStake))

	const second = await refreshVaultStateIndex(index, {
		block: { hash: `0x${'22'.repeat(32)}`, number: 10n },
		hasRep: candidate => candidate.backingUnits > 0n || candidate.disputeStakedAttoRep > 0n,
		knownVaultCount: 2n,
		loadChangedVaultAddresses: async (fromBlock, toBlock) =>
			await loadChangedVaultAddresses(
				fromBlock,
				toBlock,
				[async () => []],
				[async () => [{ args: { repRemovedAttoRep: 1n } }]],
				[...index.activeVaults.values()].filter(candidate => candidate.disputeStakedAttoRep > 0n).map(candidate => candidate.address),
			),
		loadPositions,
		loadRegistryRange: async () => [],
		readCanonicalBlockHash: async blockNumber => (blockNumber === 9n ? `0x${'11'.repeat(32)}` : `0x${'22'.repeat(32)}`),
	})

	expect(second.refreshedVaults.map(candidate => candidate.address)).toEqual([vault, escrowVault])
	expect(second.activeVaults.every(candidate => candidate.disputeStakedAttoRep === haircuttedStake)).toBeTrue()
	expect(second.activeVaults.every(candidate => isUnsafeVault(candidate.vaultAttoRepBacking, candidate.openInterestAttoEth, 20_000n, PRICE_PRECISION, candidate.disputeStakedAttoRep))).toBeTrue()
})

test('cached raw vault state recomputes backing and open interest from current pool accounting', () => {
	const raw = {
		address: vault,
		backingUnits: 2n,
		badDebtAttoEth: 1n,
		capacityOwnershipAttoRep: 3n,
		claimableFeesAttoEth: 4n,
		disputeStakedAttoRep: 5n,
		openInterestAttoEth: 0n,
		vaultAttoRepBacking: 0n,
	}

	expect(currentVaultPositionForPoolAccounting(raw, 100n, 10n, 101n, 10n)).toMatchObject({ openInterestAttoEth: 30n, vaultAttoRepBacking: 20n })
	expect(currentVaultPositionForPoolAccounting(raw, 200n, 10n, 201n, 10n)).toMatchObject({ openInterestAttoEth: 60n, vaultAttoRepBacking: 40n })
})

test('unchanged empty operator vaults are read once and then served from the event-aware cache', async () => {
	const pool = getAddress('0x0000000000000000000000000000000000000003')
	const operator = getAddress('0x0000000000000000000000000000000000000004')
	const monitorIndex = createPoolMonitorIndex()
	const emptyOperator = {
		address: operator,
		backingUnits: 0n,
		badDebtAttoEth: 0n,
		capacityOwnershipAttoRep: 0n,
		claimableFeesAttoEth: 0n,
		disputeStakedAttoRep: 0n,
		openInterestAttoEth: 0n,
		vaultAttoRepBacking: 0n,
	}
	const refresh = { refreshedVaults: [], reset: false, vaults: [] }
	const accounting = { denominator: 10n, settlementCollateralAttoEth: 100n, totalAttoRep: 100n, totalCapacityOwnershipAttoRep: 10n }
	let positionReads = 0
	const loadPosition = async () => {
		positionReads += 1
		return emptyOperator
	}

	await resolveOperatorVault(monitorIndex, pool, operator, refresh, accounting, loadPosition)
	await resolveOperatorVault(monitorIndex, pool, operator, refresh, accounting, loadPosition)

	expect(positionReads).toBe(1)
})
