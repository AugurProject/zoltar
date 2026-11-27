import { boundCloneRuntimeCode, universeCloneBindings } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { readFileSync } from 'node:fs'
import { getAddress, createPublicClient, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { chainFor } from '../../src/monitoring/operator-chain.ts'
import { securityPoolObservation, securityPoolSettings, targetAddress } from './security-pool-observation.ts'

export function securityPoolClient(overrides: Record<string, unknown> = {}) {
	const settings = securityPoolSettings()
	const observation = securityPoolObservation()
	const snapshot = observation.snapshot
	const names = [
		'SecurityPool',
		'SecurityPoolCapitalLedger',
		'SecurityPoolCommitmentIndex',
		'SecurityPoolCapitalFeeStreams',
		'SecurityPoolSettlement',
		'SecurityPoolSettlementBook',
		'SecurityPoolReporterLedger',
		'SecurityPoolPurchase',
		'SecurityPoolForkCoordinator',
		'SecurityPoolServices',
		'SecurityPoolCapitalLifecycleDelegate',
		'SecurityPoolCapitalRepairAuctionDelegate',
		'SecurityPoolRepairAuction',
		'SecurityPoolUniformPriceRepairAuction',
		'SecurityPoolResolutionPremiumBook',
	]
	const modules = new Map(names.map((name, index) => [name, index === 0 ? snapshot.securityPool : getAddress(`0x${(256 + index).toString(16).padStart(40, '0')}`)]))
	const module = (name: string) => {
		const address = modules.get(name)
		if (address === undefined) throw new Error('Fixture module missing')
		return address
	}
	snapshot.capitalLedger = module('SecurityPoolCapitalLedger')
	snapshot.commitmentIndex = module('SecurityPoolCommitmentIndex')
	const raw: unknown = JSON.parse(readFileSync(new URL('../../../../solidity/artifacts/Contracts.json', import.meta.url), 'utf8'))
	if (typeof raw !== 'object' || raw === null) throw new Error('Fixture artifacts missing')
	const contracts: unknown = Reflect.get(raw, 'contracts')
	if (typeof contracts !== 'object' || contracts === null) throw new Error('Fixture contracts missing')
	const codes = new Map(
		[...modules].map(([name, address]) => {
			const source: unknown = Reflect.get(contracts, `contracts/statoblast/${name}.sol`)
			if (typeof source !== 'object' || source === null) throw new Error(`Fixture artifact missing ${name}`)
			const artifact: unknown = Reflect.get(source, name)
			if (typeof artifact !== 'object' || artifact === null) throw new Error('Fixture artifact invalid')
			const evm: unknown = Reflect.get(artifact, 'evm')
			if (typeof evm !== 'object' || evm === null) throw new Error('Fixture EVM artifact invalid')
			const deployed: unknown = Reflect.get(evm, 'deployedBytecode')
			if (typeof deployed !== 'object' || deployed === null) throw new Error('Fixture runtime invalid')
			return [address, `0x${String(Reflect.get(deployed, 'object'))}`]
		}),
	)
	const capitalImplementation = getAddress('0x00000000000000000000000000000000000000AA')
	const setClone = (address: Address, implementation: Address, bindings: Hex) => {
		const runtime = codes.get(address)
		if (runtime === undefined) throw new Error('Fixture clone implementation missing')
		codes.set(implementation, runtime)
		codes.set(address, boundCloneRuntimeCode(implementation, bindings))
	}
	setClone(snapshot.capitalLedger, capitalImplementation, universeCloneBindings(snapshot.universeId, snapshot.repToken))
	setClone(snapshot.commitmentIndex, getAddress('0x00000000000000000000000000000000000000AB'), snapshot.capitalLedger)
	setClone(module('SecurityPoolCapitalFeeStreams'), getAddress('0x00000000000000000000000000000000000000AC'), snapshot.capitalLedger)
	const reads: { address: string; functionName: string; blockNumber?: bigint; args?: readonly unknown[] }[] = []
	const values: Record<string, unknown> = {
		collateralToken: settings.deployment.weth,
		factory: settings.deployment.securityPoolFactory,
		zoltar: settings.deployment.zoltar,
		securityPoolFactory: settings.deployment.securityPoolFactory,
		parent: '0x0000000000000000000000000000000000000000',
		originUniverseId: 0n,
		capitalLedger: snapshot.capitalLedger,
		capitalImplementation,
		settlement: module('SecurityPoolSettlement'),
		ledger: module('SecurityPoolSettlementBook'),
		reporters: module('SecurityPoolReporterLedger'),
		quoteHelper: module('SecurityPoolPurchase'),
		forkController: module('SecurityPoolForkCoordinator'),
		forkAuthority: module('SecurityPoolForkCoordinator'),
		feeStreams: module('SecurityPoolCapitalFeeStreams'),
		services: module('SecurityPoolServices'),
		lifecycleDelegate: module('SecurityPoolCapitalLifecycleDelegate'),
		repairAuctionDelegate: module('SecurityPoolCapitalRepairAuctionDelegate'),
		repairAuctions: '0x0000000000000000000000000000000000000000',
		bidderBidCount: 0n,
		unclaimedRepairAuctionBids: 0n,
		repairAuctionCohort: ['0x0000000000000000000000000000000000000000', 0n, 0n, 0n, 0n],
		premiumLedger: module('SecurityPoolResolutionPremiumBook'),
		priceFeed: snapshot.priceFeed,
		sponsorOperationReport: 0n,
		...snapshot.economics,
		minimumOutcomeExchangeRate: 1n,
		repToken: snapshot.repToken,
		commitmentIndex: snapshot.commitmentIndex,
		acceptedPrice: snapshot.acceptedPrice,
		conservativePrice: snapshot.conservativePrice,
		liquidationPrice: snapshot.liquidationPrice,
		ownerConservativePrice: snapshot.ownerConservativePrice,
		acceptedExposureLimitAttoEth: snapshot.oracleExposureLimitAttoEth,
		securityMultiplierBps: snapshot.securityMultiplierBps,
		priceValidUntil: snapshot.priceValidUntil,
		isPriceValid: true,
		demandAttoEth: snapshot.demandAttoEth,
		availableMintCapacity: snapshot.availableMintCapacityAttoEth,
		totalFreeAttoRep: 0n,
		frozen: false,
		importing: false,
		exported: false,
		ownerAccount: snapshot.ownerAccount,
		ownerCollateral: [0n, 0n, 0n],
		totals: [snapshot.totalPledgedAttoRep, snapshot.totalCommitmentAttoEth, 0n],
		getForkTime: 0n,
		getForkChoiceDeadline: 0n,
		currentBatch: 0n,
		nextBatch: 1n,
		securityPool: snapshot.securityPool,
		universeId: 0n,
		getRepToken: snapshot.repToken,
		acceptedPriceEpoch: observation.acceptedPriceEpoch,
		lastPositionId: 1n,
		balanceOf: observation.walletRep,
		liquidationStarted: 100n,
		liquidationPenaltyPaid: 0n,
		liquidationElapsed: snapshot.timestamp - 100n,
		accountOf: { owner: targetAddress, batch: 0n, rep: 99n * 10n ** 18n, commitment: snapshot.totalCommitmentAttoEth, maxHealthyPrice: 1n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n },
		...overrides,
	}
	const network = createPublicClient({
		chain: chainFor(settings),
		transport: custom({
			request: async () => {
				throw new Error('Unexpected network request')
			},
		}),
	})
	const client = new Proxy(network, {
		get(target, property) {
			if (property === 'multicall')
				return async (parameters: { contracts: readonly { address: string; functionName: string }[]; blockNumber: bigint; allowFailure: boolean }) => {
					if (parameters.allowFailure || parameters.blockNumber !== snapshot.blockNumber) throw new Error('Expected pinned required multicall')
					return parameters.contracts.map(call => {
						reads.push({ ...call, blockNumber: parameters.blockNumber })
						if (call.functionName === 'checkpoint') return undefined
						return values[`projected:${call.functionName}`] ?? values[call.functionName]
					})
				}
			if (property === 'simulateContract')
				return async (parameters: { gasPrice?: bigint }) => {
					if (values['recoveryAllowed'] !== true) throw new Error('Base fee too high')
					if (parameters.gasPrice !== values['baseFeePerGas']) throw new Error('Recovery simulation lost the pinned BASEFEE')
					return { result: undefined }
				}
			if (property === 'getLogs') return async () => values['reportLogs'] ?? []
			if (property === 'getChainId') return async () => 1
			if (property === 'getBlock') return async () => ({ number: snapshot.blockNumber, hash: snapshot.blockHash, timestamp: snapshot.timestamp, baseFeePerGas: values['baseFeePerGas'] ?? 0n })
			if (property === 'getCode') return async (parameters: { address: string }) => codes.get(getAddress(parameters.address))
			if (property === 'getBalance') return async () => observation.walletAttoEth
			if (property === 'readContract')
				return async (parameters: { address: string; functionName: string; blockNumber?: bigint; args?: readonly unknown[] }) => {
					reads.push(parameters)
					if (parameters.functionName === 'capitalLedger' && [snapshot.commitmentIndex, module('SecurityPoolCapitalFeeStreams')].includes(getAddress(parameters.address))) return snapshot.capitalLedger
					if (parameters.functionName === 'securityPool') {
						if (getAddress(parameters.address) === module('SecurityPoolSettlementBook')) return module('SecurityPoolSettlement')
					}
					if (parameters.functionName === 'implementation') return getAddress(parameters.address)
					if (!(parameters.functionName in values)) throw new Error(`Unexpected read ${parameters.functionName}`)
					const value = values[parameters.functionName]
					return typeof value === 'function' ? value(parameters.args ?? [], parameters.blockNumber) : value
				}
			return Reflect.get(target, property, target)
		},
	})
	return { client, settings, observation, values, reads, codes, module }
}
