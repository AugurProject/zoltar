import { readFileSync } from 'node:fs'
import { getAddress, createPublicClient } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { portfolioObservation, portfolioSettings, targetAddress } from './portfolio-observation.ts'

export function portfolioClient(overrides: Record<string, unknown> = {}) {
	const settings = portfolioSettings()
	const observation = portfolioObservation()
	const snapshot = observation.snapshot
	const names = [
		'SecurityPoolPortfolio',
		'SecurityPoolCapitalLedger',
		'SecurityPoolCommitmentIndex',
		'SecurityPoolCapitalFeeStreams',
		'SecurityPoolPortfolioSettlement',
		'SecurityPoolSettlementBook',
		'SecurityPoolReporterLedger',
		'SecurityPoolPortfolioPurchase',
		'SecurityPoolPortfolioForkCoordinator',
		'SecurityPoolPortfolioServices',
		'SecurityPoolCapitalLifecycleDelegate',
		'SecurityPoolCapitalAuctionDelegate',
		'SecurityPoolPortfolioAuction',
		'SecurityPoolUniformPriceAuction',
		'SecurityPoolAuctionVault',
		'SecurityPoolReportingRewards',
		'SecurityPoolResolutionPremiumBook',
	]
	const modules = new Map(names.map((name, index) => [name, index === 0 ? snapshot.portfolio : getAddress(`0x${(256 + index).toString(16).padStart(40, '0')}`)]))
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
	const reads: { address: string; functionName: string; blockNumber?: bigint }[] = []
	const values: Record<string, unknown> = {
		factory: settings.deployment.securityPoolFactory,
		zoltar: settings.deployment.zoltar,
		seedPool: targetAddress,
		getSecurityPoolPortfolio: '0x0000000000000000000000000000000000000000',
		getSecurityPoolOriginId: `0x${'1'.repeat(64)}`,
		getSecurityPool: targetAddress,
		securityPoolFactory: settings.deployment.securityPoolFactory,
		parent: '0x0000000000000000000000000000000000000000',
		originUniverseId: 0n,
		capitalLedger: snapshot.capitalLedger,
		settlement: module('SecurityPoolPortfolioSettlement'),
		ledger: module('SecurityPoolSettlementBook'),
		reporters: module('SecurityPoolReporterLedger'),
		quoteHelper: module('SecurityPoolPortfolioPurchase'),
		forkController: module('SecurityPoolPortfolioForkCoordinator'),
		forkAuthority: module('SecurityPoolPortfolioForkCoordinator'),
		feeStreams: module('SecurityPoolCapitalFeeStreams'),
		services: module('SecurityPoolPortfolioServices'),
		lifecycleDelegate: module('SecurityPoolCapitalLifecycleDelegate'),
		auctionDelegate: module('SecurityPoolCapitalAuctionDelegate'),
		auctionCohort: ['0x0000000000000000000000000000000000000000', 0n, 0n, 0n, 0n],
		reportingRewards: module('SecurityPoolReportingRewards'),
		premiumLedger: module('SecurityPoolResolutionPremiumBook'),
		priceFeed: snapshot.priceFeed,
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
		portfolio: snapshot.portfolio,
		universeId: 0n,
		getRepToken: snapshot.repToken,
		acceptedPriceEpoch: observation.acceptedPriceEpoch,
		lastPositionId: 1n,
		balanceOf: observation.walletRep,
		positionExecutionReserveAttoEth: 1n,
		liquidationStarted: 100n,
		accountOf: { owner: targetAddress, batch: 0n, rep: 99n * 10n ** 18n, commitment: snapshot.totalCommitmentAttoEth, maxHealthyPrice: 1n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n },
		...overrides,
	}
	const network = createPublicClient({
		chain: mainnet,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected network request')
			},
		}),
	})
	const client = new Proxy(network, {
		get(target, property) {
			if (property === 'getChainId') return async () => 1
			if (property === 'getBlock') return async () => ({ number: snapshot.blockNumber, hash: snapshot.blockHash, timestamp: snapshot.timestamp })
			if (property === 'getCode') return async (parameters: { address: string }) => codes.get(getAddress(parameters.address))
			if (property === 'getBalance') return async () => observation.walletAttoEth
			if (property === 'readContract')
				return async (parameters: { address: string; functionName: string; blockNumber?: bigint; args?: readonly unknown[] }) => {
					reads.push(parameters)
					if (parameters.functionName === 'requiredExecutionReserve') {
						const commitment = parameters.args?.[0]
						if (typeof commitment !== 'bigint') throw new Error('Fixture commitment missing')
						return ((commitment + snapshot.economics.minimumCommitmentAttoEth - 1n) / snapshot.economics.minimumCommitmentAttoEth) * snapshot.economics.minimumExecutionReserveAttoEth
					}
					if (parameters.functionName === 'portfolio') {
						if ([snapshot.commitmentIndex, module('SecurityPoolCapitalFeeStreams')].includes(getAddress(parameters.address))) return snapshot.capitalLedger
						if (getAddress(parameters.address) === module('SecurityPoolSettlementBook')) return module('SecurityPoolPortfolioSettlement')
					}
					if (parameters.functionName === 'ledger' && [module('SecurityPoolCapitalLifecycleDelegate'), module('SecurityPoolCapitalAuctionDelegate')].includes(getAddress(parameters.address))) return snapshot.capitalLedger
					if (!(parameters.functionName in values)) throw new Error(`Unexpected read ${parameters.functionName}`)
					return values[parameters.functionName]
				}
			return Reflect.get(target, property, target)
		},
	})
	return { client, settings, observation, values, reads, codes, module }
}
