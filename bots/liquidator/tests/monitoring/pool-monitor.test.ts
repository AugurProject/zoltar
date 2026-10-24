import { expect, test } from 'bun:test'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { createPublicClient } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { parseSettings } from '#config/settings'
import { BPS_DENOMINATOR, PRICE_PRECISION, vaultHealthBps, type VaultPosition } from '#core/strategy'
import { scanPools } from '#monitoring/pool-monitor'
import { loadChangedVaultAddresses } from '#monitoring/vault-change-logs'
import { createPoolMonitorIndex, currentVaultPositionForPoolAccounting, loadCurrentVaults, resolveOperatorVault } from '#monitoring/vault-positions'
import { createVaultStateIndex, refreshVaultStateIndex } from '#monitoring/vault-state-index'
import { getAddress } from '@zoltar/bot-shared/ethereum'

function isUnsafeVault(candidate: VaultPosition) {
	const health = vaultHealthBps(candidate.vaultAttoRepBacking, candidate.openInterestAttoEth, 20_000n, PRICE_PRECISION, candidate.disputeStakedAttoRep)
	return health !== undefined && health < BPS_DENOMINATOR
}

const vault = getAddress('0x0000000000000000000000000000000000000001')
const escrowVault = getAddress('0x0000000000000000000000000000000000000002')

test('binds operation cursor pages and the complete pool scan to one canonical block', async () => {
	const settings = parseSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	const previousBlockHash: `0x${string}` = `0x${'11'.repeat(32)}`
	const blockHash: `0x${string}` = `0x${'22'.repeat(32)}`
	const reorgedBlockHash: `0x${string}` = `0x${'33'.repeat(32)}`
	const pool = getAddress('0x0000000000000000000000000000000000000010')
	const manager = getAddress('0x0000000000000000000000000000000000000020')
	const forker = getAddress('0x0000000000000000000000000000000000000030')
	const repToken = getAddress('0x0000000000000000000000000000000000000040')
	const operator = getAddress('0x0000000000000000000000000000000000000050')
	const unregisteredTarget = getAddress('0x0000000000000000000000000000000000000060')
	const zeroApprovalId = `0x${'00'.repeat(32)}`
	settings.selectedPools = [pool]
	const contractReads: Array<{ blockNumber?: bigint; functionName: string; args?: readonly unknown[] }> = []
	const multicalls: Array<{ blockNumber?: bigint; multicallAddress?: string }> = []
	const logReads: Array<{ event?: { name?: string }; fromBlock?: bigint; toBlock?: bigint }> = []
	let reorgSnapshot = false
	let portfolio = getAddress('0x0000000000000000000000000000000000000000')
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
									openOraclePriceCoordinator: manager,
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
				return (parameters: { blockNumber?: bigint; contracts: Array<{ functionName: string }>; multicallAddress?: string }) => {
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
				return (parameters: { blockNumber?: bigint; functionName: string; args?: readonly unknown[] }) => {
					contractReads.push(parameters)
					if (parameters.functionName === 'universes') {
						return Promise.resolve({ forkQuestionId: 0n, forkTime: 0n, forkingOutcomeIndex: 0n, parentUniverseId: 0n, reputationToken: repToken })
					}
					if (parameters.functionName === 'getDeployedChildUniverses') return Promise.resolve([[], [], []])
					if (parameters.functionName === 'getSecurityPoolPortfolio') return Promise.resolve(portfolio)
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
						return Promise.resolve({ feeEligibleUnderwritingLimitAttoEth: 1n, settlementCollateralAttoEth: 10n, totalUnderwritingLimitAttoEth: 1n })
					}
					if (parameters.functionName === 'pendingReportId') return Promise.resolve(0n)
					if (parameters.functionName === 'pendingReportSponsor') return Promise.resolve(getAddress('0x0000000000000000000000000000000000000000'))
					if (parameters.functionName === 'repToken') return Promise.resolve(repToken)
					if (parameters.functionName === 'getRequestPriceCostAttoEth') return Promise.resolve(1n)
					if (parameters.functionName === 'securityPoolForker') return Promise.resolve(forker)
					if (parameters.functionName === 'systemState') return Promise.resolve(0n)
					if (parameters.functionName === 'getTotalPoolHeldAttoRep') return Promise.resolve(1n)
					if (parameters.functionName === 'forkData') return Promise.resolve([0n, getAddress('0x0000000000000000000000000000000000000000'), 0n, 0n, 0n, 0n, 0n, 0n, false, false, 0n, 0n])
					if (parameters.functionName === 'getActiveStagedOperationCount') return Promise.resolve(101n)
					if (parameters.functionName === 'getPendingSettlementOperationIds') return Promise.resolve([])
					if (parameters.functionName === 'getActiveStagedOperationsPage') {
						const [cursor, count] = parameters.args ?? []
						if (typeof cursor !== 'bigint' || typeof count !== 'bigint') throw new Error('Missing operation cursor')
						const firstId = cursor === 0n ? 303n : cursor
						const ids = Array.from({ length: Number(count) }, (_, index) => firstId - BigInt(index) * 3n)
						return Promise.resolve([
							ids,
							ids.map(() => ({
								liquidationApprovalId: zeroApprovalId,
								operation: 0,
								operationValue: 1n,
								operator,
								queuedAt: 1n,
								receiverVault: operator,
								reservedLiquidationDebtAttoEth: 0n,
								snapshotTargetBackingUnits: 0n,
								snapshotTargetUnderwritingLimitAttoEth: 0n,
								targetVault: unregisteredTarget,
								validForSeconds: 60n,
							})),
							firstId - count * 3n,
						])
					}
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
	expect(contractReads.filter(read => read.functionName === 'getActiveStagedOperationsPage').map(read => read.args)).toEqual([
		[0n, 100n],
		[3n, 1n],
	])
	expect(snapshot.pools[0]?.stagedOperations).toHaveLength(101)
	expect(snapshot.pools[0]?.stagedOperations[0]).toMatchObject({ snapshotTargetDisputeStakedAttoRep: 0n, snapshotTargetOpenInterestAttoEth: 10n, targetVault: unregisteredTarget })
	expect(contractReads.length).toBeGreaterThan(20)
	expect(contractReads.every(read => read.blockNumber === 2n)).toBeTrue()
	expect(multicalls.length).toBe(4)
	expect(multicalls.every(read => read.blockNumber === 2n)).toBeTrue()
	expect(multicalls.every(read => read.multicallAddress === settings.deployment.multicall3)).toBeTrue()
	expect(logReads.find(read => read.event?.name === 'DeploySecurityPool')).toMatchObject({ fromBlock: 0n, toBlock: 2n })
	expect(logReads.find(read => read.event?.name === 'VaultAccountingCheckpoint')).toMatchObject({ fromBlock: 2n, toBlock: 2n })

	portfolio = getAddress('0x0000000000000000000000000000000000000070')
	await expect(scanPools(client, settings, operator, monitorIndex)).rejects.toThrow(`Pool ${pool} uses portfolio ${portfolio}; this operator supports standalone vaults only`)
	portfolio = getAddress('0x0000000000000000000000000000000000000000')
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
		underwritingLimitAttoEth: PRICE_PRECISION,
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
	expect(first.activeVaults.every(candidate => !isUnsafeVault(candidate))).toBeTrue()
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
	expect(second.activeVaults.every(candidate => isUnsafeVault(candidate))).toBeTrue()
})

test('cached raw vault state recomputes backing and open interest from current pool accounting', () => {
	const raw = {
		address: vault,
		backingUnits: 2n,
		badDebtAttoEth: 1n,
		underwritingLimitAttoEth: 3n,
		claimableFeesAttoEth: 4n,
		disputeStakedAttoRep: 5n,
		openInterestAttoEth: 0n,
		vaultAttoRepBacking: 0n,
	}

	expect(currentVaultPositionForPoolAccounting(raw, 100n, 10n, 101n, 10n)).toMatchObject({ openInterestAttoEth: 31n, vaultAttoRepBacking: 20n })
	expect(currentVaultPositionForPoolAccounting(raw, 200n, 10n, 201n, 10n)).toMatchObject({ openInterestAttoEth: 61n, vaultAttoRepBacking: 40n })
})

test('unchanged empty operator vaults are read once and then served from the event-aware cache', async () => {
	const pool = getAddress('0x0000000000000000000000000000000000000003')
	const operator = getAddress('0x0000000000000000000000000000000000000004')
	const monitorIndex = createPoolMonitorIndex()
	const emptyOperator = {
		address: operator,
		backingUnits: 0n,
		badDebtAttoEth: 0n,
		underwritingLimitAttoEth: 0n,
		claimableFeesAttoEth: 0n,
		disputeStakedAttoRep: 0n,
		openInterestAttoEth: 0n,
		vaultAttoRepBacking: 0n,
	}
	const refresh = { refreshedVaults: [], reset: false, vaults: [] }
	const accounting = { denominator: 10n, settlementCollateralAttoEth: 100n, totalAttoRep: 100n, totalUnderwritingLimitAttoEth: 10n }
	let positionReads = 0
	const loadPosition = async () => {
		positionReads += 1
		return emptyOperator
	}

	await resolveOperatorVault(monitorIndex, pool, operator, refresh, accounting, loadPosition)
	await resolveOperatorVault(monitorIndex, pool, operator, refresh, accounting, loadPosition)

	expect(positionReads).toBe(1)
})

test('retains vaults with commitments even when pool-held and dispute-staked REP are zero', async () => {
	const pool = getAddress('0x0000000000000000000000000000000000000010')
	const escalationGame = getAddress('0x0000000000000000000000000000000000000011')
	const blockHash: `0x${string}` = `0x${'22'.repeat(32)}`
	const backed = getAddress('0x0000000000000000000000000000000000000001')
	const disputeStakedOnly = getAddress('0x0000000000000000000000000000000000000002')
	const feesOnly = getAddress('0x0000000000000000000000000000000000000003')
	const badDebtOnly = getAddress('0x0000000000000000000000000000000000000004')
	const commitmentOnly = getAddress('0x0000000000000000000000000000000000000005')
	const vaults = [backed, disputeStakedOnly, feesOnly, badDebtOnly, commitmentOnly]
	const client = new Proxy(createPublicClient({ chain: mainnet, transport: custom({ request: () => Promise.reject(new Error('Unexpected RPC request')) }) }), {
		get(target, property) {
			if (property === 'getBlock') return () => Promise.resolve({ hash: blockHash })
			if (property === 'readContract') {
				return (parameters: { functionName: string }) => {
					if (parameters.functionName === 'getVaults') return Promise.resolve(vaults)
					throw new Error(`Unexpected contract read: ${parameters.functionName}`)
				}
			}
			if (property === 'multicall') {
				return (parameters: { contracts: Array<{ args: readonly [string]; functionName: string }> }) =>
					Promise.resolve(
						parameters.contracts.map(contract => {
							const vault = getAddress(contract.args[0])
							if (contract.functionName === 'securityVaults') return [vault === backed ? 7n : 0n, vault === commitmentOnly ? 3n : 0n, vault === feesOnly ? 5n : 0n, 0n]
							if (contract.functionName === 'vaultBadDebtAttoEth') return vault === badDebtOnly ? 3n : 0n
							if (contract.functionName === 'getVaultDisputeBackingAttoRep') return vault === disputeStakedOnly ? 9n : 0n
							throw new Error(`Unexpected multicall read: ${contract.functionName}`)
						}),
					)
			}
			return Reflect.get(target, property, target)
		},
	})
	const index = createVaultStateIndex<VaultPosition>()
	const refresh = await loadCurrentVaults(client, getAddress('0xB657B12CD9d80421DBC2bc70c43d6b2ff9409108'), index, pool, escalationGame, BigInt(vaults.length), 100n, 10n, 0n, 0n, { hash: blockHash, number: 2n })
	expect(refresh.refreshedVaults.map(vault => vault.address)).toEqual(vaults)
	expect([...index.activeVaults.values()].map(vault => vault.address)).toEqual([backed, disputeStakedOnly, commitmentOnly])
})

test('ordinary settlement refreshes retained dispute stakes without per-vault checkpoint events', async () => {
	const pool = getAddress('0x0000000000000000000000000000000000000010')
	const game = getAddress('0x0000000000000000000000000000000000000011')
	const unstakedVault = getAddress('0x0000000000000000000000000000000000000003')
	const previousHash: `0x${string}` = `0x${'11'.repeat(32)}`
	const currentHash: `0x${string}` = `0x${'22'.repeat(32)}`
	const position = (address: typeof vault, stake: bigint): VaultPosition => ({ address, backingUnits: 0n, badDebtAttoEth: 0n, underwritingLimitAttoEth: 0n, claimableFeesAttoEth: 0n, disputeStakedAttoRep: stake, openInterestAttoEth: 0n, vaultAttoRepBacking: 0n })
	const index = createVaultStateIndex<VaultPosition>()
	index.blockHash = previousHash
	index.blockNumber = 9n
	index.knownVaultCount = 3n
	index.activeVaults.set(vault.toLowerCase(), position(vault, 9n))
	index.activeVaults.set(escrowVault.toLowerCase(), position(escrowVault, 5n))
	index.activeVaults.set(unstakedVault.toLowerCase(), { ...position(unstakedVault, 0n), backingUnits: 3n })
	const logs: Array<{ address: string; event: { name: string }; fromBlock: bigint; toBlock: bigint }> = []
	const client = new Proxy(createPublicClient({ chain: mainnet, transport: custom({ request: () => Promise.reject(new Error('Unexpected RPC request')) }) }), {
		get(target, property) {
			if (property === 'getBlock') return ({ blockNumber }: { blockNumber: bigint }) => Promise.resolve({ hash: blockNumber === 9n ? previousHash : currentHash })
			if (property === 'getLogs')
				return (request: (typeof logs)[number]) => {
					logs.push(request)
					return Promise.resolve(request.event.name === 'OrdinarySettlementInitialized' ? [{ args: { outcome: 2n, winningPrincipalAttoRep: 5n, reservedAttoRep: 5n } }] : [])
				}
			if (property === 'multicall')
				return (request: { blockNumber: bigint; contracts: Array<{ args: readonly [string]; functionName: string }> }) => {
					expect(request.blockNumber).toBe(10n)
					return Promise.resolve(
						request.contracts.map(contract => {
							if (contract.functionName === 'securityVaults') return [0n, 0n, 0n, 0n]
							if (contract.functionName === 'vaultBadDebtAttoEth') return 0n
							if (contract.functionName === 'getVaultDisputeBackingAttoRep') return getAddress(contract.args[0]) === escrowVault ? 5n : 0n
							throw new Error(`Unexpected multicall read: ${contract.functionName}`)
						}),
					)
				}
			return Reflect.get(target, property, target)
		},
	})
	const refresh = await loadCurrentVaults(client, pool, index, pool, game, 3n, 3n, 3n, 0n, 0n, { hash: currentHash, number: 10n })
	expect(refresh.refreshedVaults.map(candidate => [candidate.address, candidate.disputeStakedAttoRep])).toEqual([
		[vault, 0n],
		[escrowVault, 5n],
	])
	expect(refresh.vaults.map(candidate => candidate.address)).toEqual([escrowVault, unstakedVault])
	expect(logs.find(request => request.event.name === 'OrdinarySettlementInitialized')).toMatchObject({ address: game, fromBlock: 10n, toBlock: 10n })
})
