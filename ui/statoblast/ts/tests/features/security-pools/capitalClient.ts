import { boundCloneRuntimeCode, universeCloneBindings } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { createPublicClient, http, getAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { createMockReadClient, createBlockWithTimestamp, createMulticallStub, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getInfraContractAddresses, getSecurityPoolRuntimeCode } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCapitalLifecycleDelegate_SecurityPoolCapitalLifecycleDelegate as lifecycleArtifact,
	statoblast_SecurityPoolCapitalAuctionDelegate_SecurityPoolCapitalAuctionDelegate as auctionDelegateArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as feesArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as engineArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	statoblast_SecurityPoolPurchase_SecurityPoolPurchase as purchaseArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	statoblast_SecurityPoolServices_SecurityPoolServices as servicesArtifact,
	statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as premiumArtifact,
	statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as openArtifact,
} from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { capitalSnapshot, owner, securityPool, capital, token, index } from './capitalFixture.js'
export const modules = {
	capitalImplementation: getAddress('0x0000000000000000000000000000000000000072'),
	indexImplementation: getAddress('0x0000000000000000000000000000000000000073'),
	feesImplementation: getAddress('0x0000000000000000000000000000000000000074'),
	fees: getAddress('0x0000000000000000000000000000000000000061'),
	engine: getAddress('0x0000000000000000000000000000000000000062'),
	book: getAddress('0x0000000000000000000000000000000000000063'),
	reporters: getAddress('0x0000000000000000000000000000000000000064'),
	purchase: getAddress('0x0000000000000000000000000000000000000065'),
	fork: getAddress('0x0000000000000000000000000000000000000066'),
	lifecycle: getAddress('0x0000000000000000000000000000000000000067'),
	services: getAddress('0x0000000000000000000000000000000000000068'),
	premium: getAddress('0x0000000000000000000000000000000000000070'),
	auctionDelegate: getAddress('0x0000000000000000000000000000000000000071'),
}
export function capitalClient(initial = capitalSnapshot()) {
	let snapshot = initial
	let setupStage = 4n
	const overrides: Record<string, unknown> = {}
	const scopedOverrides = new Map<string, unknown>()
	const reads: { address: Address; name: string; args: readonly unknown[] | undefined; blockNumber: bigint | undefined }[] = []
	const multicallBlocks: (bigint | undefined)[] = []
	// Calls to these addresses fail in a multicall that allows failures, as calls to a non-security-pool would.
	const failingMulticallAddresses = new Set<Address>()
	const codes = new Map<Address, Hex>([
		[securityPool, getSecurityPoolRuntimeCode()],
		[modules.capitalImplementation, `0x${capitalArtifact.evm.deployedBytecode.object}`],
		[modules.lifecycle, `0x${lifecycleArtifact.evm.deployedBytecode.object}`],
		[modules.auctionDelegate, `0x${auctionDelegateArtifact.evm.deployedBytecode.object}`],
		[index, boundCloneRuntimeCode(modules.indexImplementation, capital)],
		[modules.indexImplementation, `0x${indexArtifact.evm.deployedBytecode.object}`],
		[modules.fees, boundCloneRuntimeCode(modules.feesImplementation, capital)],
		[modules.feesImplementation, `0x${feesArtifact.evm.deployedBytecode.object}`],
		[modules.engine, `0x${engineArtifact.evm.deployedBytecode.object}`],
		[modules.book, `0x${bookArtifact.evm.deployedBytecode.object}`],
		[modules.reporters, `0x${reporterArtifact.evm.deployedBytecode.object}`],
		[modules.purchase, `0x${purchaseArtifact.evm.deployedBytecode.object}`],
		[modules.fork, `0x${forkArtifact.evm.deployedBytecode.object}`],
		[modules.services, `0x${servicesArtifact.evm.deployedBytecode.object}`],
		[modules.premium, `0x${premiumArtifact.evm.deployedBytecode.object}`],
		[token, `0x${openArtifact.evm.deployedBytecode.object}`],
	])
	const client = createPublicClient({ transport: http('https://example.test') }).extend(() => ({
		getChainId: async () => snapshot.chainId,
		multicall: createMulticallStub(async request =>
			request.contracts.map(contract => {
				const name = getContractFunctionName(contract)
				if (!(name in overrides)) throw new Error(`Unexpected capital multicall ${name}`)
				multicallBlocks.push(request.blockNumber)
				// With failures allowed, the client reports each call the node ran as its own success or failure entry.
				if (request.allowFailure !== true) return overrides[name]
				return failingMulticallAddresses.has(getAddress(contract.address)) ? { status: 'failure', error: new Error('execution reverted') } : { status: 'success', result: overrides[name] }
			}),
		),
		getCode: async ({ address }: { address: Address }) => codes.get(address) ?? (address === capital ? boundCloneRuntimeCode(modules.capitalImplementation, universeCloneBindings(snapshot.universeId, token)) : undefined),
		getBalance: async () => snapshot.walletAttoEth,
		getBlock: async () => ({ ...createBlockWithTimestamp(snapshot.timestamp), number: snapshot.blockNumber, hash: snapshot.blockHash }),
		...createMockReadClient(async request => {
			reads.push({ address: request.address, name: request.functionName, args: request.args, blockNumber: request.blockNumber })
			const scopedKey = `${request.address}:${request.functionName}`
			if (scopedOverrides.has(scopedKey)) return scopedOverrides.get(scopedKey)
			// Deriving deployment addresses hashes large init codes; unrelated reads need no derivation.
			const infrastructure = ['zoltar', 'factory', 'auctionDeployer'].includes(request.functionName) ? getInfraContractAddresses() : undefined
			const values: Record<string, unknown> = {
				setupStage,
				quoteMintRecoveryRep: 0n,
				collateralToken: snapshot.collateralToken,
				originUniverseId: snapshot.originUniverseId,
				universeId: snapshot.universeId,
				capitalLedger: capital,
				capitalImplementation: modules.capitalImplementation,
				zoltar: infrastructure?.zoltar,
				factory: infrastructure?.securityPoolFactory,
				isSecurityPool: true,
				settlement: modules.engine,
				commitmentIndex: index,
				repToken: token,
				getRepToken: token,
				ledger: modules.book,
				implementation: request.address,
				lifecycleDelegate: modules.lifecycle,
				auctionDelegate: modules.auctionDelegate,
				auctionDeployer: infrastructure?.securityPoolAuctionDeployer,
				services: modules.services,
				forkAuthority: modules.fork,
				premiumLedger: modules.premium,
				minimumOutcomeExchangeRate: snapshot.economics.minimumOutcomeRate,
				...snapshot.economics,
				acceptedPrice: snapshot.acceptedPrice,
				conservativePrice: snapshot.conservativePrice,
				liquidationPrice: snapshot.liquidationPrice,
				ownerConservativePrice: snapshot.ownerConservativePrice,
				priceFeed: snapshot.priceFeed,
				acceptedExposureLimitAttoEth: snapshot.oracleExposureLimitAttoEth,
				securityMultiplierBps: snapshot.securityMultiplierBps,
				priceValidUntil: snapshot.priceValidUntil,
				isPriceValid: snapshot.priceValid,
				demandAttoEth: snapshot.demandAttoEth,
				availableMintCapacity: snapshot.availableMintCapacityAttoEth,
				totalFreeAttoRep: snapshot.totalFreeAttoRep,
				frozen: snapshot.frozen,
				importing: snapshot.importing,
				exported: snapshot.exported,
				ownerAccount: snapshot.ownerAccount,
				ownerCollateral: [snapshot.ownerPrincipalAttoRep, snapshot.ownerCommitmentAttoEth, snapshot.withdrawableAttoRep],
				totals: [snapshot.totalPledgedAttoRep, snapshot.totalCommitmentAttoEth, snapshot.healthyCommitmentAttoEth],
				currentBatch: snapshot.currentBatch,
				nextBatch: snapshot.nextBatch,
				getForkTime: snapshot.forkTime,
				getForkChoiceDeadline: snapshot.forkChoiceDeadline,
				questionAdmissionPolicy: token,
				reporters: modules.reporters,
				quoteHelper: modules.purchase,
				forkController: modules.fork,
				feeStreams: modules.fees,
				questionCount: snapshot.questionCount,
				balanceOf: request.address === snapshot.collateralToken ? snapshot.walletCollateral : snapshot.walletAttoRep,
				allowance: request.address === snapshot.collateralToken ? snapshot.collateralAllowance : snapshot.allowanceAttoRep,
				securityPoolCount: 0n,
				getOutcomeLabels: ['Yes', 'No'],
				getNonDecisionThresholdAttoRep: 2n * 10n ** 18n,
				getUniverseTheoreticalSupplyAttoRep: 1_000_000n * 10n ** 18n,
				...overrides,
			}
			if (request.functionName === 'securityPool') {
				if (request.address === modules.book) return modules.engine
				return securityPool
			}
			if (request.functionName === 'accountOf' || request.functionName === 'liquidationStarted') {
				const position = snapshot.positions.find(position => position.id === request.args?.[0])
				if (position === undefined) throw new Error('Unknown position')
				if (request.functionName === 'accountOf') return [position.owner, position.batch, position.rep, position.commitment, position.maxHealthyPrice, position.releasedRep, position.feesAttoEth, position.feesAttoRep, position.remainingCommitment]
				return position.liquidationStarted
			}
			if (request.functionName === 'previewRetirement') {
				const preview = snapshot.positions.find(position => position.id === request.args?.[0])?.retirementPreview
				const statuses = ['not-retiring', 'imports-open', 'demand-exceeds-healthy', 'earlier-requests', 'insufficient-spare', 'ready']
				return preview === undefined ? [0n, snapshot.currentBatch, 0n, 0n, 0n, 0n, 0n] : [BigInt(statuses.indexOf(preview.status)), preview.effectiveCurrentBatch, preview.healthyCommitment, preview.spareCommitment, preview.queuedAheadCommitment, preview.commitmentReduction, preview.releasedRep]
			}
			if (request.functionName === 'getQuestions') {
				if ('getQuestions' in overrides) return overrides['getQuestions']
				const start = request.args?.[0]
				const count = request.args?.[1]
				if (typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Missing page bounds')
				const remaining = snapshot.questionCount - start
				return Array.from({ length: Number(remaining < count ? remaining : count) }, (_, i) => start + BigInt(i) + 1n)
			}
			if (!(request.functionName in values)) throw new Error(`Unexpected capital read ${request.functionName}`)
			return values[request.functionName]
		}),
	}))
	const backend = { ...createFakeBackend({ accountAddress: owner }), createReadClient: () => client }
	return {
		client,
		backend,
		reads,
		codes,
		multicallBlocks,
		setRead: (name: string, value: unknown, address?: Address) => {
			if (address === undefined) overrides[name] = value
			else scopedOverrides.set(`${address}:${name}`, value)
		},
		failMulticallAt: (address: Address) => {
			failingMulticallAddresses.add(getAddress(address))
		},
		setSetupStage: (stage: bigint) => {
			setupStage = stage
		},
		setSnapshot: (next: typeof snapshot) => {
			snapshot = next
		},
		install: () => installActiveEnvironmentForTesting(backend),
	}
}
