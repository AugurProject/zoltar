import { startDashboardServer } from '../src/dashboard/dashboard-server.ts'

let paused = false
let configurationRequests = 0
const longUniverseId = '452312848583266388373324160190187140051835877600158453279131187530910662655'
let approvedUniverses = ['101', longUniverseId]
let selectedPools = ['0x1111111111111111111111111111111111111111', '0x3333333333333333333333333333333333333333']
let strategy = {
	allowAutomaticDeposits: true,
	allowAutomaticVaultMigrations: true,
	allowAutomaticWithdrawals: true,
	candidatePriority: 'largest-bonus',
	fallbackRepPerEthPrice: '12.4',
	maximumGasCostEth: '0.02',
	maximumLiquidationDebtEth: '25',
	maximumOracleRequestCostEth: '0.02',
	maximumRepPerPool: '10000',
	maximumTotalDeployedRep: '25000',
	minimumLiquidationDebtEth: '1',
	minimumRepWithdrawal: '10',
	minimumRewardValueEth: '0.02',
	redeemFeesAboveEth: '0.01',
	stalePriceFundingBufferBps: 15000,
	stagedOperationValidForSeconds: 240,
	vaultTargetHealthBps: 12500,
	vaultTopUpHealthBps: 11000,
	vaultWithdrawHealthBps: 15000,
	walletRepReserve: '100',
}

function pool(address: string, questionId: string, selected: boolean, isPriceValid: boolean, candidateCount: number, universeId: string, approvedUniverse: boolean, parent = '0x0000000000000000000000000000000000000000', systemState = '0', forkOutcomeIndex?: string) {
	return {
		activeVaultCount: candidateCount === 0 ? '4' : '18',
		address,
		approvedUniverse,
		botVault: {
			address: '0x9999999999999999999999999999999999999999',
			allowanceEth: selected ? '32.5' : '0',
			healthBps: selected ? '12500' : undefined,
			ownership: '0',
			rep: selected ? '818.42' : '0',
			unpaidEthFees: selected ? '0.0084' : '0',
		},
		candidates: Array.from({ length: candidateCount }, (_, index) => ({
			bonusValueEth: (1.25 - index * 0.1).toFixed(2),
			debtToMoveEth: (25 - index).toString(),
			priceDistanceBps: '1820',
			repToMove: '262.5',
			resultingHealthBps: '12500',
			target: `0x${(index + 4).toString(16).padStart(40, '0')}`,
			topUpRep: '362.5',
		})),
		collateralEth: '1942.73',
		currentRetentionRate: '999999987000000000',
		forkActivationTime: systemState === '1' ? '1785416250' : '0',
		forkOutcomeIndex,
		initialReportPriorityFeeWeiPerGas: '2000000000',
		isPriceValid,
		lastPrice: '10.284',
		lastSettlementTimestamp: '1785416250',
		manager: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		minLiquidationPriceDistanceBps: '1000',
		minimumToken1Report: '1',
		multiplierBps: '20000',
		parent,
		parentUniverseId: parent === '0x0000000000000000000000000000000000000000' ? undefined : '0',
		pendingReportId: isPriceValid ? '0' : '8124',
		pendingReportSponsor: isPriceValid ? '0x0000000000000000000000000000000000000000' : '0x9999999999999999999999999999999999999999',
		questionId,
		repToken: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		requestPriceCostEth: '0.0042',
		selected,
		securityPoolForker: '0xcccccccccccccccccccccccccccccccccccccccc',
		stagedOperations: [],
		systemState,
		totalAllowanceEth: '644.2',
		totalRep: '14628.817',
		truncatedVaults: false,
		universeId,
		vaults: [],
	}
}

const activities = [
	{
		at: new Date(Date.now() - 25_000).toISOString(),
		details: 'pool=0x1111…1111 target=0x0000…0004 debt=25000000000000000000',
		kind: 'liquidation',
		message: 'Liquidation candidate selected',
		status: 'dry-run',
	},
	{
		at: new Date(Date.now() - 95_000).toISOString(),
		kind: 'scan',
		message: 'Factory registry reconciled',
		status: 'info',
	},
	{
		at: new Date(Date.now() - 180_000).toISOString(),
		kind: 'deposit',
		message: 'Deposit REP for liquidator vault health',
		status: 'confirmed',
	},
]

const server = startDashboardServer(4183, {
	getConfiguration: async () => {
		await Bun.sleep(400)
		configurationRequests += 1
		if (configurationRequests === 1) throw new Error('Fixture configuration temporarily unavailable')
		return { approvedUniverses, selectedPools, strategy }
	},
	getState: () => ({
		activities,
		execute: false,
		lastScanAt: new Date().toISOString(),
		lastScannedBlock: '8842011',
		metrics: {
			approvedUniverseCount: approvedUniverses.length,
			assumedDebtEth: '58.9',
			candidateCount: 4,
			deployedRep: '1636.84',
			eligiblePoolCount: 1,
			poolCount: 3,
			selectedPoolCount: selectedPools.length,
			walletEth: '2.184',
			walletRep: '2508.19',
		},
		paused,
		pools: [
			pool('0x1111111111111111111111111111111111111111', '42', true, true, 0, '0', false, undefined, '1'),
			pool('0x2222222222222222222222222222222222222222', '42', false, true, 0, '101', true, '0x1111111111111111111111111111111111111111', '2', '1'),
			pool('0x3333333333333333333333333333333333333333', '900719925474099312345', true, false, 4, longUniverseId, true),
		],
		scanning: false,
		startedAt: new Date(Date.now() - 3_600_000).toISOString(),
		status: paused ? 'paused' : 'dry-run',
		universes: [
			{ approved: false, forkedPoolCount: 1, forkQuestionId: '42', forkTime: '1785416250', id: '0', migratableVaultCount: 0, operationalPoolCount: 0, poolCount: 1, repToken: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', selectedPoolCount: 1 },
			{ approved: true, forkedPoolCount: 0, forkQuestionId: '42', forkTime: '0', id: '101', migratableVaultCount: 1, operationalPoolCount: 0, outcomeIndex: '1', parentId: '0', poolCount: 1, repToken: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', selectedPoolCount: 0 },
			{ approved: true, forkedPoolCount: 0, forkQuestionId: '900719925474099312345', forkTime: '0', id: longUniverseId, migratableVaultCount: 0, operationalPoolCount: 1, poolCount: 1, repToken: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', selectedPoolCount: 1 },
			{ approved: false, forkedPoolCount: 0, forkQuestionId: '900719925474099312345', forkTime: '0', id: '301', migratableVaultCount: 0, operationalPoolCount: 0, outcomeIndex: '2', parentId: longUniverseId, poolCount: 0, repToken: '0xdddddddddddddddddddddddddddddddddddddddd', selectedPoolCount: 0 },
		],
		wallet: '0x9999999999999999999999999999999999999999',
		walletRep: {
			'0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb': '2508.19',
		},
	}),
	hostname: '127.0.0.1',
	setPaused: value => {
		paused = Reflect.get(value as object, 'paused') === true
		return { paused }
	},
	setSelectedPools: value => {
		if (!Array.isArray(value)) throw new Error('Expected selected-pool array')
		selectedPools = value.map(String)
		return { approvedUniverses, selectedPools, strategy }
	},
	setApprovedUniverses: value => {
		if (!Array.isArray(value)) throw new Error('Expected approved-universe array')
		approvedUniverses = value.map(String)
		return { approvedUniverses, selectedPools, strategy }
	},
	setSigner: value => ({
		wallet: Reflect.get(value as object, 'privateKey') === '' ? undefined : '0x9999999999999999999999999999999999999999',
	}),
	setStrategy: value => {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			throw new Error('Expected strategy object')
		}
		strategy = { ...strategy, ...value }
		return { approvedUniverses, selectedPools, strategy }
	},
})

console.log(`Liquidator dashboard fixture: ${server.url}`)
