// Capital positions of the demo security pool's genesis-universe ledger: one owner open to take-over, one in the
// scanner's warning band, one without commitment, and the take-over, cure and report operation between them.
export const demoCapitalLedger = `0x${'5'.repeat(40)}`
export const demoCapitalSecurityPool = `0x${'6'.repeat(40)}`
const usdc = { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 }
// The first mainnet rich-list address owns the position at risk, so its profile and rich-list card show it.
export const demoCapitalOwner = '0x00000000000000000000000002468acf13579bde'
const receiver = `0x${'c'.repeat(40)}`
const idle = `0x${'d'.repeat(40)}`
const rep = (whole: bigint) => (whole * 10n ** 18n).toString()
const usdcUnits = (whole: bigint) => (whole * 10n ** 6n).toString()
// attoREP per whole collateral token scaled by 1e18, for a 6-decimal token.
const price = (repPerUsdc: bigint) => (repPerUsdc * 10n ** 30n).toString()

const ledgerFields = {
	securityPool: demoCapitalSecurityPool,
	universeId: '0',
	securityMultiplierBps: '15000',
	acceptedPrice: price(200n),
	conservativePrice: price(210n),
	liquidationPrice: price(190n),
	priceValidUntil: '1767312000',
	priceValid: true,
	frozen: false,
	importing: false,
	universeForked: false,
	collateral: usdc,
}

const ownerState = (owner: string, fields: Record<string, unknown>): { readonly owner: string } & Record<string, unknown> => ({ ...ledgerFields, ledger: demoCapitalLedger, ...fields, owner })

const positionStates = [
	ownerState(demoCapitalOwner, {
		positionId: '7',
		principalAttoRep: rep(12_350n),
		commitmentAttoEth: usdcUnits(50n),
		withdrawableAttoRep: '0',
		freeAttoRep: '0',
		pledgedAttoRep: rep(12_350n),
		targetHealthFactorBps: '12000',
		unclaimedFeesAttoEth: '1500000',
		unclaimedFeesAttoRep: rep(2n),
		ownerConservativePrice: price(210n),
		requiredAttoRep: rep(14_250n),
		healthFactorBps: '8666',
		maxHealthyPrice: price(164n),
		releasedAttoRep: '0',
		retirementBatch: '0',
		remainingCommitmentAttoEth: '0',
		liquidationStartedAt: '1767225600',
		belowLiquidationPrice: true,
		takeoverPreconditionsMet: true,
	}),
	ownerState(receiver, {
		positionId: '12',
		principalAttoRep: rep(13_000n),
		commitmentAttoEth: usdcUnits(40n),
		withdrawableAttoRep: rep(250n),
		freeAttoRep: '0',
		pledgedAttoRep: rep(13_000n),
		targetHealthFactorBps: '11000',
		unclaimedFeesAttoEth: '0',
		unclaimedFeesAttoRep: '0',
		ownerConservativePrice: price(210n),
		requiredAttoRep: rep(11_400n),
		healthFactorBps: '11403',
		maxHealthyPrice: price(216n),
		releasedAttoRep: '0',
		retirementBatch: '0',
		remainingCommitmentAttoEth: '0',
		liquidationStartedAt: '0',
		belowLiquidationPrice: false,
		takeoverPreconditionsMet: false,
	}),
	ownerState(idle, { positionId: '0', principalAttoRep: rep(700n), commitmentAttoEth: '0', withdrawableAttoRep: rep(700n), freeAttoRep: rep(700n), pledgedAttoRep: '0', targetHealthFactorBps: '10000', unclaimedFeesAttoEth: '0', unclaimedFeesAttoRep: '0', ownerConservativePrice: price(210n) }),
]

const risks = [
	{ protocol_state: 'takeover-preconditions-met', scanner_severity: 'critical', scanner_reason: 'Pledged REP is below the requirement at the liquidation price and an adverse price observation has started the take-over clock' },
	{ protocol_state: 'healthy', scanner_severity: 'warning', scanner_reason: 'Health factor is below the scanner warning threshold of 12000 bps.' },
	{ protocol_state: 'uncommitted', scanner_severity: 'healthy', scanner_reason: 'No commitment is authorized, so no principal backs open interest' },
]

export const demoCapitalPositions = (blockNumber: string) =>
	positionStates.map((state, index) => ({
		ledger_address: demoCapitalLedger,
		owner_address: state.owner,
		securityPool: demoCapitalSecurityPool,
		universe_id: '0',
		block_number: blockNumber,
		read_status: 'success',
		source_method: 'augurscan.capital-owner-state.v1',
		read_result: state,
		...risks[index],
	}))

export const demoCapitalLedgers = (blockNumber: string) => [
	{
		ledger_address: demoCapitalLedger,
		securityPool: demoCapitalSecurityPool,
		universe_id: '0',
		owner_count: positionStates.length,
		block_number: blockNumber,
		read_result: { ...ledgerFields, pledgedAttoRep: rep(25_350n), commitmentAttoEth: usdcUnits(90n), healthyCommitmentAttoEth: usdcUnits(40n), demandAttoEth: usdcUnits(60n), priceFeed: `0x${'7'.repeat(40)}`, lastPositionId: '12' },
	},
]

export const demoLiquidations = (blockNumber: string) => {
	const evidence = (eventName: string, logIndex: number, eventData: Record<string, unknown>, owners: { readonly source_owner: string | null; readonly receiver_owner: string | null }) => ({
		event_name: eventName,
		event_data: eventData,
		source_contract: eventName === 'ReportOperationAttempted' ? `0x${'7'.repeat(40)}` : demoCapitalLedger,
		block_number: blockNumber,
		block_hash: `0x${'e'.repeat(64)}`,
		tx_hash: `0x${'f'.repeat(63)}${logIndex}`,
		log_index: logIndex,
		ledger_address: demoCapitalLedger,
		securityPool: demoCapitalSecurityPool,
		universe_id: '0',
		collateral: usdc,
		...owners,
	})
	return [
		evidence('CommitmentTakenOver', 3, { sourceId: '7', receiverId: '12', commitment: usdcUnits(40n), awardAttoRep: rep(300n) }, { source_owner: demoCapitalOwner, receiver_owner: receiver }),
		evidence('CommitmentCured', 2, { positionId: '7', removedCommitment: usdcUnits(10n) }, { source_owner: demoCapitalOwner, receiver_owner: null }),
		evidence('ReportOperationAttempted', 1, { reportId: '1842', sponsor: receiver, operationIndex: '0', success: true }, { source_owner: null, receiver_owner: null }),
	]
}

/** The address profile and rich-list card of an owner list its latest position per universe ledger. */
export const demoOwnedCapitalPositions = (owner: string, blockNumber: string) =>
	positionStates
		.filter(state => state.owner === owner.toLowerCase())
		.map(state => {
			const text = (key: string) => {
				const value = state[key]
				return typeof value === 'string' ? value : null
			}
			return {
				ledgerAddress: demoCapitalLedger,
				securityPool: demoCapitalSecurityPool,
				universeId: '0',
				readStatus: 'success',
				principalAttoRep: text('principalAttoRep'),
				commitmentAttoEth: text('commitmentAttoEth'),
				healthFactorBps: text('healthFactorBps'),
				unclaimedFeesAttoEth: text('unclaimedFeesAttoEth'),
				unclaimedFeesAttoRep: text('unclaimedFeesAttoRep'),
				collateral: usdc,
				blockNumber,
			}
		})

export const demoCapitalDetail = (ledger: string, owner: string, blockNumber: string, blockHash: string) => {
	const position = demoCapitalPositions(blockNumber).find(item => item.ledger_address === ledger.toLowerCase() && item.owner_address === owner.toLowerCase())
	if (position === undefined) return undefined
	const earlier = { ...position.read_result, principalAttoRep: rep(12_650n), pledgedAttoRep: rep(12_650n), commitmentAttoEth: usdcUnits(100n), healthFactorBps: '12105', belowLiquidationPrice: false, takeoverPreconditionsMet: false, liquidationStartedAt: '0' }
	const event = (eventName: string, logIndex: number, eventData: Record<string, unknown>) => ({
		universe_id: '0',
		collateral: usdc,
		event_name: eventName,
		event_data: eventData,
		source_contract: demoCapitalLedger,
		block_number: String(BigInt(blockNumber) - 40n),
		block_hash: blockHash,
		tx_hash: `0x${'d'.repeat(63)}${logIndex}`,
		log_index: logIndex,
	})
	return {
		...position,
		block_hash: blockHash,
		ledger: demoCapitalLedgers(blockNumber)[0],
		history: {
			snapshots: [
				{ block_number: blockNumber, block_hash: blockHash, read_status: 'success', read_result: position.read_result },
				{ block_number: String(BigInt(blockNumber) - 25n), block_hash: blockHash, read_status: 'failed', read_result: null, read_failure_reason: 'execution reverted' },
				{ block_number: String(BigInt(blockNumber) - 50n), block_hash: blockHash, read_status: 'success', read_result: earlier },
			],
			limit: 250,
			truncated: false,
		},
		events: {
			items: [
				...demoLiquidations(blockNumber).filter(item => item.source_owner === position.owner_address || item.receiver_owner === position.owner_address || item.event_data['sponsor'] === position.owner_address),
				event('CommitmentAuthorized', 1, { owner: position.owner_address, positionId: position.read_result['positionId'], rep: rep(12_650n), commitment: usdcUnits(100n), targetHealthFactorBps: '12000' }),
				event('PrincipalDeposited', 0, { payer: position.owner_address, owner: position.owner_address, amountAttoRep: rep(12_650n) }),
			],
			limit: 100,
			hasMore: false,
		},
	}
}

/** Fee economics of the demo universe and the current fee streams of two of its questions. */
export const demoFeeEconomics = (blockNumber: string) => [
	{
		ledger_address: demoCapitalLedger,
		securityPool: demoCapitalSecurityPool,
		universe_id: '0',
		collateral: usdc,
		block_number: blockNumber,
		fees: { annualFeeBps: '200', purchaseFeeBps: '30', vestingOutstandingAttoEth: usdcUnits(700n), vestingOutstandingAttoRep: '0', deferredAttoEth: '0', deferredAttoRep: '0', settlementBook: `0x${'8'.repeat(40)}`, bookId: '1', bookFeesEnabled: true },
		accrued_atto_eth: usdcUnits(1_250n),
		accrual_count: 41,
		purchase_fees_atto_eth: usdcUnits(960n),
		purchase_cash_atto_eth: usdcUnits(320_000n),
		purchase_count: 18,
		premium_funded_atto_eth: usdcUnits(60n),
		earnings_funded_atto_eth: usdcUnits(900n),
		claimed_atto_eth: usdcUnits(1_100n),
		claimed_atto_rep: rep(12n),
		claim_count: 7,
		burned_atto_eth: usdcUnits(25n),
		burned_atto_rep: '0',
		burn_count: 2,
	},
]

export const demoQuestionFeeStreams = (blockNumber: string) => [
	{
		ledger_address: demoCapitalLedger,
		universe_id: '0',
		collateral: usdc,
		question_id: '42',
		question_title: 'Will the 2030 global mean temperature anomaly exceed 1.5°C?',
		claim_unit_scale: '1000000000',
		rate_claim_units_per_second: '203',
		rate_claim_units_per_year: (203n * 31_536_000n).toString(),
		end_timestamp: '1893456000',
		block_number: blockNumber,
		tx_hash: `0x${'a'.repeat(64)}`,
		log_index: 4,
	},
	{
		ledger_address: demoCapitalLedger,
		universe_id: '0',
		collateral: usdc,
		question_id: '44',
		question_title: 'Will the protocol meet its launch reliability target?',
		claim_unit_scale: '1000000000',
		rate_claim_units_per_second: '95',
		rate_claim_units_per_year: (95n * 31_536_000n).toString(),
		end_timestamp: '1704067200',
		block_number: blockNumber,
		tx_hash: `0x${'c'.repeat(64)}`,
		log_index: 6,
	},
	{ ledger_address: demoCapitalLedger, universe_id: '0', collateral: usdc, question_id: '43', question_title: null, claim_unit_scale: '1000000000', rate_claim_units_per_second: '0', rate_claim_units_per_year: '0', end_timestamp: '0', block_number: blockNumber, tx_hash: `0x${'b'.repeat(64)}`, log_index: 5 },
]
