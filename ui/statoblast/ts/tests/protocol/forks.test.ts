/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { depositRepToVaultToSecurityPool } from '@zoltar/ui-statoblast-shared/protocol/securityVault.js'
import { finalizeSecurityPoolTruthAuction } from '@zoltar/ui-statoblast-shared/protocol/truthAuctionActions.js'
import { migrateSharesFromUniverse } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { forkZoltarWithOwnEscalation, loadForkAuctionDetails, migrateRepToZoltarFromSecurityPool, migrateSecurityVault } from '@zoltar/ui-statoblast-shared/protocol/forks.js'
import type { TransactionRequestPreview } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { getForkOutcomeKey } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { statoblast_tokens_ShareToken_ShareToken } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { asWriteClient, createBlockWithTimestamp, createMockLoaderClient, createMockWriteClient, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'

const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
const shareTokenAddress = getAddress('0x00000000000000000000000000000000000000b2')
const truthAuctionAddress = getAddress('0x00000000000000000000000000000000000000f6')
const escalationGameAddress = getAddress('0x00000000000000000000000000000000000000e6')
const defaultForkData = [0n, zeroAddress, 0n, 0n, 0n, 0n, 0n, 0n, false, false, 0n, 0n] as const

function createForkMockWriteClient(onSendTransaction: (request: { data?: Hex | undefined; gas?: bigint | undefined; to?: Address | null | undefined }) => void) {
	return createMockWriteClient(onSendTransaction, async request => {
		if (request.functionName === 'universeId') return 12n
		if (request.functionName === 'shareToken') return shareTokenAddress
		if (request.functionName === 'getOwnForkMigrationStatus') return [false, 0n, 0n, 0n, 0n]
		if (request.functionName === 'getVaultCount') return 0n
		if (request.functionName === 'escalationGame') return escalationGameAddress
		if (request.functionName === 'getDepositsByOutcomeLength') return 0n
		throw new Error(`Unexpected readContract function: ${request.functionName}`)
	})
}

const questionId = 1n
const questionTuple = ['Question', 'Description', 1n, 2n, 2n, 0n, 100n, ''] as const

function createForkDetailsClient({ poolRead, computeClearing, ownForkMigrationStatus = [false, 0n, 0n, 0n, 0n] }: { poolRead: readonly unknown[]; computeClearing?: readonly unknown[]; ownForkMigrationStatus?: readonly unknown[] }) {
	return createMockLoaderClient({
		getBlock: async () => createBlockWithTimestamp(5n),
		multicall: async request => {
			const functionName = getContractFunctionName(request.contracts[0])
			if (functionName === 'questionId') return poolRead
			if (functionName === 'getForkTime') return [0n]
			if (functionName === 'questions') return [questionTuple, 1n]
			if (functionName === 'computeClearing' && computeClearing !== undefined) return computeClearing
			throw new Error(`Unexpected multicall contract: ${functionName}`)
		},
		readContract: async request => {
			if (request.functionName === 'getOutcomeLabels') return ['Yes', 'No']
			if (request.functionName === 'getOwnForkMigrationStatus') return ownForkMigrationStatus
			throw new Error(`Unexpected readContract function: ${request.functionName}`)
		},
	})
}

describe('forks protocol client', () => {
	test('finalizeSecurityPoolTruthAuction sends no repair contribution', async () => {
		let capturedValue: bigint | undefined
		const client = createMockWriteClient(request => {
			capturedValue = request.value
		})

		await finalizeSecurityPoolTruthAuction(asWriteClient(client), securityPoolAddress, 12n)

		expect(capturedValue).toBeUndefined()
	})

	test('irreversible fork and migration actions explain their effect and amounts in the review step', async () => {
		const previews: TransactionRequestPreview[] = []
		const repTokenAddress = getAddress('0x00000000000000000000000000000000000000e7')
		const client = asWriteClient(
			createMockWriteClient(
				() => undefined,
				async request => {
					if (request.functionName === 'getTotalPoolHeldAttoRep') return 4n * 10n ** 18n
					if (request.functionName === 'escalationGame') return escalationGameAddress
					if (request.functionName === 'repToken') return repTokenAddress
					if (request.functionName === 'balanceOf' && request.address === repTokenAddress && Array.isArray(request.args) && request.args[0] === escalationGameAddress) return 2n * 10n ** 18n
					throw new Error(`Unexpected readContract function: ${request.functionName}`)
				},
			),
		)
		client.onTransactionPrepared = preview => previews.push(preview)
		await forkZoltarWithOwnEscalation(client, securityPoolAddress, 12n)
		await migrateRepToZoltarFromSecurityPool(client, securityPoolAddress, 12n, ['yes', 'no'], 5n * 10n ** 18n)
		await migrateSecurityVault(client, securityPoolAddress, 12n, 'invalid', { repAttoRep: 3n * 10n ** 18n, underwritingLimitAttoEth: 2n * 10n ** 18n })
		expect(previews.map(preview => [preview.reviewTitle, preview.reviewDescription])).toEqual([
			['Trigger universe fork · 6\u00a0REP', 'Forks the universe on this pool’s question because escalation ended without a decision. The universe splits into Yes, No, and Invalid, this pool stops operating, and 6\u00a0REP held by the pool and its escalation game moves into fork migration. This can’t be undone.'],
			['Migrate pool-held REP to Yes, No · 5\u00a0REP', 'Moves this pool’s 5\u00a0REP attributed to Yes, No into the matching child universe. It affects the whole pool, not just your vault, and can’t be undone.'],
			['Migrate vault to Invalid · 3\u00a0REP', 'Moves all your vault REP (3\u00a0REP) and underwriting commitments (2\u00a0ETH) from this pool to the Invalid universe. This can’t be undone or split across outcomes.'],
		])
	})

	test('a failed fork-amount read stops the fork before any review or wallet write', async () => {
		const previews: TransactionRequestPreview[] = []
		let writes = 0
		const repTokenAddress = getAddress('0x00000000000000000000000000000000000000e7')
		const client = asWriteClient(
			createMockWriteClient(
				() => {
					writes += 1
				},
				async request => {
					if (request.functionName === 'getTotalPoolHeldAttoRep') return 4n * 10n ** 18n
					if (request.functionName === 'escalationGame') return escalationGameAddress
					if (request.functionName === 'repToken') return repTokenAddress
					if (request.functionName === 'balanceOf') throw new Error('balanceOf unavailable')
					throw new Error(`Unexpected readContract function: ${request.functionName}`)
				},
			),
		)
		client.onTransactionPrepared = preview => previews.push(preview)
		await expect(forkZoltarWithOwnEscalation(client, securityPoolAddress, 12n)).rejects.toThrow('balanceOf unavailable')
		expect(previews).toEqual([])
		expect(writes).toBe(0)
	})

	test('a pool without an escalation game reviews only its pool-held REP', async () => {
		const previews: TransactionRequestPreview[] = []
		const client = asWriteClient(
			createMockWriteClient(
				() => undefined,
				async request => {
					if (request.functionName === 'getTotalPoolHeldAttoRep') return 4n * 10n ** 18n
					if (request.functionName === 'escalationGame') return zeroAddress
					if (request.functionName === 'repToken') return getAddress('0x00000000000000000000000000000000000000e7')
					throw new Error(`Unexpected readContract function: ${request.functionName}`)
				},
			),
		)
		client.onTransactionPrepared = preview => previews.push(preview)
		await forkZoltarWithOwnEscalation(client, securityPoolAddress, 12n)
		expect(previews.map(preview => preview.reviewTitle)).toEqual(['Trigger universe fork · 4\u00a0REP'])
	})

	test('migration reviews omit amounts the caller could not supply', async () => {
		const previews: TransactionRequestPreview[] = []
		const client = asWriteClient(createMockWriteClient(() => undefined))
		client.onTransactionPrepared = preview => previews.push(preview)
		await migrateRepToZoltarFromSecurityPool(client, securityPoolAddress, 12n, ['yes'])
		await migrateSecurityVault(client, securityPoolAddress, 12n, 'no')
		await migrateSecurityVault(client, securityPoolAddress, 12n, 'yes', { repAttoRep: undefined, underwritingLimitAttoEth: 2n * 10n ** 18n })
		expect(previews.map(preview => [preview.reviewTitle, preview.reviewDescription])).toEqual([
			['Migrate pool-held REP to Yes', 'Moves this pool’s REP attributed to Yes into the matching child universe. It affects the whole pool, not just your vault, and can’t be undone.'],
			['Migrate vault to No', 'Moves all your vault REP and underwriting commitments from this pool to the No universe. This can’t be undone or split across outcomes.'],
			['Migrate vault to Yes', 'Moves all your vault REP and underwriting commitments (2\u00a0ETH) from this pool to the Yes universe. This can’t be undone or split across outcomes.'],
		])
	})

	test('migrateSharesFromUniverse sorts target outcomes before submission without deduplicating', async () => {
		let capturedData: Hex | undefined
		let capturedTo: Address | null | undefined
		const client = createForkMockWriteClient(request => {
			capturedData = request.data
			capturedTo = request.to
		})

		const result = await migrateSharesFromUniverse(client, securityPoolAddress, 'yes', [7n, 3n, 7n])

		expect(capturedTo).toBe(shareTokenAddress)
		expect(capturedData).toBeDefined()
		const decodedCall = decodeFunctionData({
			abi: statoblast_tokens_ShareToken_ShareToken.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		expect(decodedCall.functionName).toBe('migrate')
		expect(decodedCall.args?.[1]).toEqual([3n, 7n, 7n])
		expect(result.targetOutcomeIndexes).toEqual([3n, 7n, 7n])
	})

	test('migrateSharesFromUniverse names the migrated shares and that migration cannot be undone in the review', async () => {
		const previews: { reviewAmount?: string | undefined; reviewDescription?: string | undefined; reviewTitle?: string | undefined }[] = []
		const client = { ...createForkMockWriteClient(() => undefined), onTransactionPrepared: (preview: { reviewAmount?: string | undefined; reviewDescription?: string | undefined; reviewTitle?: string | undefined }) => previews.push(preview) }

		await migrateSharesFromUniverse(client, securityPoolAddress, 'no', [1n], 25n * 10n ** 17n)

		expect(previews).toHaveLength(1)
		expect(previews[0]?.reviewTitle).toBe('Migrate No shares')
		expect(previews[0]?.reviewAmount).toBe('2.5 No shares')
		expect(previews[0]?.reviewDescription).toBe('Moves your whole No balance into the selected child universes. Migration cannot be undone.')
	})

	test('getForkOutcomeKey treats the default root-pool fork outcome as none', () => {
		expect(getForkOutcomeKey(0n, getAddress('0x0000000000000000000000000000000000000000'))).toBe('none')
		expect(getForkOutcomeKey(0n, securityPoolAddress)).toBe('invalid')
		expect(getForkOutcomeKey(1n, securityPoolAddress)).toBe('yes')
	})

	test('depositRepToVaultToSecurityPool rejects zero amounts before encoding a transaction', async () => {
		let sendTransactionCount = 0
		const client = createForkMockWriteClient(() => {
			sendTransactionCount += 1
		})

		await expect(depositRepToVaultToSecurityPool(asWriteClient(client), securityPoolAddress, 0n)).rejects.toThrow('REP deposit amount must be greater than zero')
		expect(sendTransactionCount).toBe(0)
	})

	test('loadForkAuctionDetails keeps the default root-pool fork outcome unset and inactive', async () => {
		const details = await loadForkAuctionDetails(createForkDetailsClient({ poolRead: [questionId, zeroAddress, 1n, 0n, zeroAddress, 0n, defaultForkData, 3n, [0n, 0n, 0n]] }), securityPoolAddress)

		expect(details.parentSecurityPoolAddress).toBe(zeroAddress)
		expect(details.forkOutcome).toBe('none')
		expect(details.hasForkActivity).toBe(false)
		expect(details.ownForkRepBuckets).toBeUndefined()
	})

	test('loadForkAuctionDetails rejects malformed fork data instead of casting tuple reads', async () => {
		const client = createForkDetailsClient({ poolRead: [questionId, zeroAddress, 1n, 0n, zeroAddress, 0n, [0n, zeroAddress, 0n, 'bad-migrated-rep', 0n, 0n, 0n, 0n, false, false, 0n, 0n], 3n, [0n, 0n, 0n]] })

		await expect(loadForkAuctionDetails(client, securityPoolAddress)).rejects.toThrow('Unexpected security pool fork data migrated REP response')
	})

	test('loadForkAuctionDetails preserves migration end time after truth auction has started', async () => {
		const forkActivationTime = 1_000n
		const client = createForkDetailsClient({
			poolRead: [questionId, truthAuctionAddress, 1n, 0n, zeroAddress, 0n, [0n, zeroAddress, 1n, 0n, 0n, 0n, 0n, 0n, false, false, 1n, forkActivationTime], 4n, [0n, 0n, 0n]],
			computeClearing: [[false, 0n, 0n, 0n], 1n, 0n, false, 1n, 1n, 0n, false, 0n, 0n, 0n],
		})

		const details = await loadForkAuctionDetails(client, securityPoolAddress)

		expect(details.truthAuctionStartedAt).toBe(1n)
		expect(details.migrationEndsAt).toBe(forkActivationTime + 4_838_400n)
	})

	describe('finalized underfunded truth auctions', () => {
		const finalizedUnderfundedPoolRead = [questionId, zeroAddress, 1n, 3n, truthAuctionAddress, 0n, [0n, zeroAddress, 1n, 0n, 0n, 0n, 0n, 0n, false, false, 1n, 1n], 0n]
		const loadTruthAuction = async (computeClearing: readonly unknown[]) => {
			const details = await loadForkAuctionDetails(createForkDetailsClient({ poolRead: finalizedUnderfundedPoolRead, computeClearing }), securityPoolAddress)
			if (details.truthAuction === undefined) throw new Error('Expected truth auction details to load.')
			return details.truthAuction
		}

		test('loadForkAuctionDetails preserves finalized underfunded auction fields from the multicall tuple', async () => {
			const finalizedClearingTick = 12n
			const syntheticThreshold = 7n * 10n ** 17n
			const underfundedWinningAttoEth = 9n * 10n ** 18n
			const truthAuction = await loadTruthAuction([[false, 99n, underfundedWinningAttoEth, 0n], 20n * 10n ** 18n, 13n * 10n ** 18n, true, 12n * 10n ** 18n, 1n * 10n ** 18n, 12n * 10n ** 18n, true, syntheticThreshold, underfundedWinningAttoEth, finalizedClearingTick])

			expect(truthAuction.finalized).toBe(true)
			expect(truthAuction.underfunded).toBe(true)
			expect(truthAuction.clearingTick).toBe(finalizedClearingTick)
			expect(truthAuction.clearingPrice).toBe(syntheticThreshold)
			expect(truthAuction.underfundedThreshold).toBe(syntheticThreshold)
			expect(truthAuction.underfundedWinningAttoEth).toBe(underfundedWinningAttoEth)
		})

		test('loadForkAuctionDetails hides the synthetic clearing price when a finalized underfunded auction has no winning prefix', async () => {
			const noWinningPrefixThreshold = 2n * 10n ** 18n
			const truthAuction = await loadTruthAuction([[false, 0n, 0n, 0n], 20n * 10n ** 18n, 0n, true, 12n * 10n ** 18n, 1n * 10n ** 18n, 0n, true, noWinningPrefixThreshold, 0n, 0n])

			expect(truthAuction.finalized).toBe(true)
			expect(truthAuction.underfunded).toBe(true)
			expect(truthAuction.clearingTick).toBe(0n)
			expect(truthAuction.clearingPrice).toBeUndefined()
			expect(truthAuction.underfundedThreshold).toBe(noWinningPrefixThreshold)
			expect(truthAuction.underfundedWinningAttoEth).toBe(0n)
		})
	})

	test('loadForkAuctionDetails surfaces own-fork migration diagnostics only for own-fork pools', async () => {
		const client = createForkDetailsClient({
			poolRead: [questionId, securityPoolAddress, 1n, 0n, zeroAddress, 0n, [30n, zeroAddress, 0n, 0n, 0n, 0n, 0n, 0n, true, false, 1n, 1n], 4n],
			ownForkMigrationStatus: [true, 30n, 12n, 9n, 18n],
		})

		const details = await loadForkAuctionDetails(client, securityPoolAddress)

		expect(details.auctionableAttoRepAtFork).toBe(30n)
		expect(details.ownForkRepBuckets).toEqual({
			vaultRepAtForkAttoRep: 12n,
			escalationChildRepPerSelectedOutcomeAttoRep: 9n,
			escrowSourceRepAtForkAttoRep: 18n,
		})
	})
})
