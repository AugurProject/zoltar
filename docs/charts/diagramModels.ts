import { contractInteractionEdges } from './chartModels'
import type { ChartMetadata, DiagramDirection, DiagramGraphEdge, DiagramGraphNode, DiagramGraphSection, DiagramGraphSpec, DiagramNodeKind } from './diagramTypes'

function node(id: string, title: string, kind: DiagramNodeKind = 'neutral', details: string[] = [], width?: number): DiagramGraphNode {
	return {
		...(details.length === 0 ? {} : { details }),
		id,
		kind,
		title,
		...(width === undefined ? {} : { width }),
	}
}

function edge(id: string, source: string, target: string, label?: string, dashed = false): DiagramGraphEdge {
	return {
		...(dashed ? { dashed } : {}),
		id,
		...(label === undefined ? {} : { label }),
		source,
		target,
	}
}

function section(id: string, nodes: DiagramGraphNode[], edges: DiagramGraphEdge[], options: { description?: string; direction?: DiagramDirection; title?: string } = {}): DiagramGraphSection {
	return {
		...(options.description === undefined ? {} : { description: options.description }),
		...(options.direction === undefined ? {} : { direction: options.direction }),
		edges,
		id,
		nodes,
		...(options.title === undefined ? {} : { title: options.title }),
	}
}

function diagram(metadata: ChartMetadata, sections: DiagramGraphSection[], direction: DiagramDirection = 'DOWN'): DiagramGraphSpec {
	return { ...metadata, direction, sections }
}

const contractPanelDefinitions = [
	{
		description: 'Construction-time validation and deployment',
		id: 'deploy',
		phases: new Set(['Deployment', 'Universe lifecycle']),
		title: '1. Deploy & wire',
	},
	{
		description: 'Claims, dispute escrow, and guarded price execution',
		id: 'runtime',
		phases: new Set(['Market runtime', 'Price discovery', 'Price settlement', 'Resolution', 'Risk execution', 'Risk operations']),
		title: '2. Operate & resolve',
	},
	{
		description: 'Child creation, REP migration, state migration, and backing repair',
		id: 'fork',
		phases: new Set(['Backing repair', 'Fork migration', 'Fork snapshot', 'Share migration']),
		title: '3. Fork & repair',
	},
] as const

function contractNodeId(panelId: string, label: string): string {
	return `${panelId}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

function contractNodeKind(label: string): DiagramNodeKind {
	if (label === 'Escalation Game') return 'red'
	if (label === 'Pool Factory' || label === 'Pool Forker' || label === 'Migration Proxy' || label === 'Truth Auction') return 'gold'
	if (label === 'Security Pool' || label === 'Share Token') return 'green'
	return 'blue'
}

function contractPanel(definition: (typeof contractPanelDefinitions)[number]): DiagramGraphSection {
	const panelEdges = contractInteractionEdges.filter(candidate => definition.phases.has(candidate.phase))
	const labels = [...new Set(panelEdges.flatMap(candidate => [candidate.source, candidate.receiver]))]
	return section(
		definition.id,
		labels.map(label => node(contractNodeId(definition.id, label), label, contractNodeKind(label))),
		panelEdges.map(candidate => edge(candidate.id, contractNodeId(definition.id, candidate.source), contractNodeId(definition.id, candidate.receiver), candidate.action, candidate.id === 'oracle-coordinator-callback' || candidate.id === 'coordinator-pool-execute')),
		{ description: definition.description, title: definition.title },
	)
}

export const diagramGraphSpecs = {
	'fig-auction-lifecycle': diagram(
		{
			ariaDescription:
				'After migration closes, startTruthAuction takes one of two paths. When no sale is required, TruthAuctionFinalized activates the child immediately and bypasses AuctionStarted, bidding, and bid settlement. Otherwise AuctionStarted opens bidding. Once demand establishes a clearing tick, bids below it may refund before finalization. Finalization later activates the child, after which paged calls settle winning and partial bids plus any remaining refunds.',
			ariaLabel: 'Auction lifecycle after migration closes',
			height: 300,
			width: 1070,
		},
		[
			section(
				'auction-lifecycle',
				[
					node('migration', 'Migration closes', 'slate', ['child transition ready']),
					node('start', 'Start transition', 'gold', ['startTruthAuction']),
					node('bid', 'Bid', 'blue', ['AuctionStarted']),
					node('early-refund', 'Refund losing bids', 'teal', ['below established clearing tick', 'before finalization']),
					node('finalize', 'Finalize', 'gold', ['compute clearing']),
					node('operational-no-sale', 'Operational', 'green', ['child activated', 'no bids to settle']),
					node('operational-auction', 'Operational', 'green', ['child activated', 'bids remain claimable']),
					node('settle', 'Settle remaining bids', 'teal', ['winning, partial, and refunds']),
				],
				[
					edge('auction-migration-start', 'migration', 'start'),
					edge('auction-start-operational', 'start', 'operational-no-sale', 'no sale needed'),
					edge('auction-start-bid', 'start', 'bid', 'repair required'),
					edge('auction-bid-early-refund', 'bid', 'early-refund', 'clearing tick found'),
					edge('auction-bid-finalize', 'bid', 'finalize', 'no early refund'),
					edge('auction-early-refund-finalize', 'early-refund', 'finalize', 'then finalize'),
					edge('auction-finalize-operational', 'finalize', 'operational-auction', 'activate child'),
					edge('auction-operational-settle', 'operational-auction', 'settle', 'paged settlement'),
				],
			),
		],
	),
	'fig-contract-interaction-map': diagram(
		{
			ariaDescription: 'Three panels separate construction-time deployment, recurring market and oracle operations, and fork migration and backing repair. Repeated contracts preserve local reading order, short edge labels name each action, and the detailed table below gives the exact boundary.',
			ariaLabel: 'Zoltar and Statoblast contract interactions grouped into deployment, runtime, and fork phases',
			height: 880,
			width: 1120,
		},
		contractPanelDefinitions.map(contractPanel),
	),
	'fig-deployment-mask': diagram(
		{
			ariaDescription: 'A row of deployment steps maps by index into bit positions in a uint256 mask. Each step sets its bit only when code exists at that configured address.',
			ariaLabel: 'Deployment mask maps ordered deployment steps to bits',
			height: 260,
			width: 920,
		},
		[
			section(
				'deployment-mask',
				[node('step-0', 'step 0', 'blue'), node('step-1', 'step 1', 'blue'), node('step-2', 'step 2', 'blue'), node('bit-0', 'bit 0', 'gold', ['code?']), node('bit-1', 'bit 1', 'gold', ['code?']), node('bit-2', 'bit 2', 'gold', ['code?']), node('mask', 'returned uint256', 'slate', ['matching bits set'], 210)],
				[edge('deployment-step-0-bit-0', 'step-0', 'bit-0'), edge('deployment-step-1-bit-1', 'step-1', 'bit-1'), edge('deployment-step-2-bit-2', 'step-2', 'bit-2'), edge('deployment-bit-0-mask', 'bit-0', 'mask'), edge('deployment-bit-1-mask', 'bit-1', 'mask'), edge('deployment-bit-2-mask', 'bit-2', 'mask')],
			),
		],
	),
	'fig-invariant-layers': diagram(
		{
			ariaDescription: 'Four connected layers run from local authority guards through cross-contract conservation and lifecycle liveness to economic security. A failure in an earlier layer invalidates the safety claims built above it.',
			ariaLabel: 'Protocol invariant layers',
			height: 280,
			width: 920,
		},
		[
			section(
				'invariant-layers',
				[
					node('authority', 'Authority', 'blue', ['canonical callers', 'one-time wiring']),
					node('conservation', 'Conservation', 'green', ['ETH, REP, shares', 'claims and reserves']),
					node('lifecycle', 'Lifecycle', 'gold', ['legal transitions', 'permissionless liveness']),
					node('economics', 'Economics', 'red', ['arbitrage incentives', 'inclusion assumptions']),
				],
				[edge('invariant-authority-conservation', 'authority', 'conservation', 'supports'), edge('invariant-conservation-lifecycle', 'conservation', 'lifecycle', 'supports'), edge('invariant-lifecycle-economics', 'lifecycle', 'economics', 'supports')],
			),
		],
	),
	'fig-liquidation-punitive-flow': diagram(
		{
			ariaDescription:
				'Floor-rounded proportional capacity ownership and ceiling-rounded REP backing units leave the target vault. The authorized receiver incurs the exact reported security-bond debt increase and receives those ownership and backing units. The operator only submits the transaction. Escalation claims, fees, surplus, and unmatched ownership remain with the target; only on a full-target request does debt left by the award cap or integer allocation rounding become target-local bad debt.',
			ariaLabel: 'Liquidation accounting transfer from target vault to authorized receiver',
			height: 230,
			width: 900,
		},
		[
			section(
				'liquidation-transfer',
				[node('target', 'Target vault', 'red', ['claims and fees remain', 'full-target residual → bad debt'], 240), node('receiver', 'Receiver vault', 'green', ['incurs exact reported debt', 'receives ownership + backing'], 240)],
				[edge('liquidation-target-receiver', 'target', 'receiver', 'floor ownership · ceil backing units')],
			),
		],
		'RIGHT',
	),
	'fig-mmr-peaks': diagram(
		{
			ariaDescription: 'A leaf count of thirteen is shown as binary one one zero one, corresponding to occupied peaks at heights zero, two, and three which are later bagged into one root.',
			ariaLabel: 'Merkle Mountain Range peaks are determined by set bits in the leaf count',
			height: 300,
			width: 920,
		},
		[
			section(
				'mmr-peaks',
				[node('leaf-count', 'leafCount = 13', 'blue'), node('binary', 'binary 1101', 'slate', ['set bits: 0, 2, 3']), node('peak-0', 'peak 0', 'green'), node('peak-2', 'peak 2', 'green'), node('peak-3', 'peak 3', 'green'), node('root', 'MMR root', 'gold', ['bag occupied peaks'])],
				[
					edge('mmr-count-binary', 'leaf-count', 'binary'),
					edge('mmr-binary-peak-0', 'binary', 'peak-0', 'bit 0'),
					edge('mmr-binary-peak-2', 'binary', 'peak-2', 'bit 2'),
					edge('mmr-binary-peak-3', 'binary', 'peak-3', 'bit 3'),
					edge('mmr-peak-0-root', 'peak-0', 'root'),
					edge('mmr-peak-2-root', 'peak-2', 'root'),
					edge('mmr-peak-3-root', 'peak-3', 'root'),
				],
			),
		],
	),
	'fig-mmr-proof-anatomy': diagram(
		{
			ariaDescription:
				'The membership lane combines the carried deposit leaf with bottom-up siblings inside its selected peak, then with other occupied peak roots in ascending height order to reconstruct the snapshot root. The nullifier lane hashes the stable parent deposit index and combines it with a fixed-depth sibling path to prove the claim has not already been consumed.',
			ariaLabel: 'A carried-deposit proof has an MMR membership lane and a separate nullifier lane',
			height: 470,
			width: 940,
		},
		[
			section(
				'membership',
				[
					node('deposit-leaf', 'Deposit leaf', 'blue', ['peak-local leafIndex']),
					node('siblings', 'In-peak siblings', 'slate', ['bottom-up', 'count = peak height']),
					node('selected-peak', 'Selected peak', 'green', ['peakIndex is its height']),
					node('other-peaks', 'Other peak roots', 'slate', ['ascending height', 'bag right to left']),
					node('snapshot-root', 'Snapshot root', 'gold'),
				],
				[edge('mmr-leaf-siblings', 'deposit-leaf', 'siblings', 'hash path'), edge('mmr-siblings-selected', 'siblings', 'selected-peak'), edge('mmr-selected-other', 'selected-peak', 'other-peaks', 'combine peaks'), edge('mmr-other-root', 'other-peaks', 'snapshot-root')],
				{ description: 'Reconstruct the carried snapshot root', title: 'MMR membership lane' },
			),
			section(
				'nullifier',
				[node('deposit-index', 'parentDepositIndex', 'blue', ['stable replay identity']), node('nullifier-siblings', 'Nullifier siblings', 'slate', ['fixed depth = 64']), node('nullifier-root', 'Current nullifier root', 'gold', ['empty leaf proves unspent'])],
				[edge('nullifier-index-siblings', 'deposit-index', 'nullifier-siblings', 'hash path'), edge('nullifier-siblings-root', 'nullifier-siblings', 'nullifier-root')],
				{ description: 'Prove the stable deposit identity remains unspent', title: 'Nullifier lane' },
			),
		],
	),
	'fig-openoracle-integration-flow': diagram(
		{
			ariaDescription: 'After OpenOracle settles, the coordinator validates the report. An accepted report refreshes the REP/ETH price and runs pending operations through local guardrails; a rejected report leaves the price cache unchanged and terminally fails the attached pending batch.',
			ariaLabel: 'OpenOracle integration flow',
			height: 330,
			width: 980,
		},
		[
			section(
				'openoracle-integration',
				[
					node('operation', 'User operation', 'blue', ['liquidate or withdraw REP']),
					node('coordinator-request', 'Coordinator', 'gold', ['price cache', 'staging guards']),
					node('oracle', 'OpenOracle', 'blue', ['sponsor funds', 'disputer may replace']),
					node('settlement', 'OpenOracle settlement', 'teal', ['settler finalizes'], 260),
					node('coordinator-callback', 'Coordinator callback', 'gold', ['validate settled report', 'clear pending report'], 250),
					node('guardrails', 'Accepted report', 'green', ['refresh price cache', 'execute with local guards']),
					node('rejected', 'Rejected report', 'red', ['price cache unchanged', 'attached batch fails terminally'], 260),
				],
				[
					edge('openoracle-operation-coordinator', 'operation', 'coordinator-request', 'stage'),
					edge('openoracle-coordinator-oracle', 'coordinator-request', 'oracle', 'fund report'),
					edge('openoracle-oracle-settlement', 'oracle', 'settlement', 'dispute or settle'),
					edge('openoracle-settlement-coordinator', 'settlement', 'coordinator-callback', 'settled callback'),
					edge('openoracle-coordinator-guardrails', 'coordinator-callback', 'guardrails', 'accepted report'),
					edge('openoracle-coordinator-rejected', 'coordinator-callback', 'rejected', 'rejected report'),
				],
			),
		],
	),
	'fig-statoblast-auction-balance-sheet': diagram(
		{
			ariaDescription: 'A child pool before auction, after full auction repair, and after weak auction demand settles at the collateral actually raised.',
			ariaLabel: 'Truth auction repair balance sheet',
			height: 330,
			width: 960,
		},
		[
			section(
				'auction-balance-sheet',
				[
					node('before', 'Before auction', 'red', ['proportional ETH collateral', 'migrated REP', 'redemptions impaired'], 230),
					node('repaired', 'Successful repair', 'green', ['parent settlement target met', 'less child REP', 'redemptions restored'], 240),
					node('weak', 'Weak-demand settlement', 'gold', ['auction ETH below cap', 'no caller donation', 'activate at raised collateral'], 290),
				],
				[edge('auction-before-repaired', 'before', 'repaired', 'sufficient demand'), edge('auction-before-weak', 'before', 'weak', 'weak demand')],
			),
		],
		'RIGHT',
	),
	'fig-statoblast-fork-state-machine': diagram(
		{
			ariaDescription: 'Contract states and conditional transition functions move an operational parent through migration and bounded truth-auction settlement to an operational child.',
			ariaLabel: 'SecurityPool fork state machine',
			height: 360,
			width: 960,
		},
		[
			section(
				'fork-state-machine',
				[node('parent', 'Operational', 'green', ['parent pool']), node('forked', 'PoolForked', 'red', ['parent halted']), node('migration', 'ForkMigration', 'gold', ['child pool']), node('auction', 'ForkTruthAuction', 'gold', ['repair phase']), node('child', 'Operational', 'green', ['child activated'])],
				[edge('fork-parent-forked', 'parent', 'forked', 'fork mode'), edge('fork-forked-migration', 'forked', 'migration', 'create child'), edge('fork-migration-auction', 'migration', 'auction', 'start transition'), edge('fork-auction-child', 'auction', 'child', 'finalized; immediate if no sale')],
			),
		],
	),
	'fig-statoblast-oracle-flow': diagram(
		{
			ariaDescription:
				'A REP withdrawal or liquidation executes immediately with a valid cached price or becomes an active staged operation behind an OpenOracle report. An accepted settlement callback attempts up to four still-active pending operations, skipping any already consumed; each attempt is consumed on success or terminal failure. A rejected report leaves the price cache unchanged and terminally consumes its attached pending batch. Additional staged operations remain active outside that callback batch and can execute later with a fresh price.',
			ariaLabel: 'Queued REP/ETH oracle operation flow for REP withdrawals and liquidations',
			height: 390,
			width: 940,
		},
		[
			section(
				'oracle-operation',
				[
					node('request', 'Operation request', 'blue', ['withdraw REP or liquidation']),
					node('price', 'Valid price?', 'gold', ['configured freshness window']),
					node('execute', 'Execute now', 'green', ['no oracle ETH cost']),
					node('stage', 'Stage active operation', 'gold', ['missing or stale price']),
					node('oracle', 'OpenOracle', 'blue', ['sponsor funds', 'dispute or settle']),
					node('callback', 'Callback batch', 'blue', ['attempt up to 4 active', 'skip already consumed']),
					node('consume', 'Consume callback attempt', 'green', ['success or terminal execution failure']),
					node('rejected', 'Rejected report', 'red', ['price cache unchanged', 'terminally fail attached batch'], 250),
					node('reject-consume', 'Consume attached batch', 'red', ['terminal failure without execution']),
					node('overflow', 'Outside callback batch', 'teal', ['remains active', 'execute later with fresh price']),
				],
				[
					edge('oracle-request-price', 'request', 'price'),
					edge('oracle-price-execute', 'price', 'execute', 'fresh'),
					edge('oracle-price-stage', 'price', 'stage', 'missing or stale'),
					edge('oracle-stage-report', 'stage', 'oracle', 'up to 4 pending slots'),
					edge('oracle-stage-overflow', 'stage', 'overflow', 'additional operations'),
					edge('oracle-report-callback', 'oracle', 'callback', 'accepted report'),
					edge('oracle-report-rejected', 'oracle', 'rejected', 'rejected report'),
					edge('oracle-callback-consume', 'callback', 'consume', 'attempt'),
					edge('oracle-rejected-consume', 'rejected', 'reject-consume', 'terminally fail batch'),
					edge('oracle-overflow-execute', 'overflow', 'execute', 'later with fresh price'),
				],
			),
		],
	),
	'fig-statoblast-pool-accounting': diagram(
		{
			ariaDescription: 'REP deposits mint proportional REP backing units, decayed settlement collateral increments the fee index, and vault capacity ownership claims fees from that index.',
			ariaLabel: 'Pool accounting conversions',
			height: 430,
			width: 920,
		},
		[
			section(
				'rep-backing',
				[node('rep', 'REP amount', 'blue'), node('units', 'REP backing units', 'green', ['proportional claim']), node('vault-rep', 'Vault REP backing', 'teal', ['live pool-held REP'])],
				[edge('accounting-rep-units', 'rep', 'units', 'mint units'), edge('accounting-units-vault', 'units', 'vault-rep', 'inverse conversion')],
				{ description: 'Backing units preserve each vault’s proportional REP claim', title: 'REP backing ledger' },
			),
			section(
				'fee-accounting',
				[node('collateral', 'Settlement collateral', 'blue'), node('fee-index', 'Fee index', 'gold', ['global accumulator']), node('vault-fees', 'Vault fees', 'green', ['capacity ownership'])],
				[edge('accounting-collateral-index', 'collateral', 'fee-index', 'decay produces fees'), edge('accounting-index-fees', 'fee-index', 'vault-fees', 'checkpoint')],
				{ description: 'Collateral decay accrues through a separate fee index', title: 'Fee ledger' },
			),
		],
	),
	'fig-statoblast-share-lifecycle': diagram(
		{
			ariaDescription: 'ETH mints Invalid, Yes, and No shares. Operational pools redeem full sets, and finalized winning shares redeem through outcome settlement.',
			ariaLabel: 'Complete set lifecycle',
			height: 360,
			width: 860,
		},
		[
			section(
				'share-lifecycle',
				[node('eth', 'User sends ETH', 'blue'), node('full-set', 'Receives full set', 'green', ['Invalid + Yes + No']), node('before', 'Before finalization', 'teal', ['burn full set']), node('after', 'After finalization', 'gold', ['winning leg redeems']), node('settlement', 'Collateral settlement', 'slate')],
				[
					edge('shares-eth-full-set', 'eth', 'full-set', 'createCompleteSet'),
					edge('shares-full-set-before', 'full-set', 'before'),
					edge('shares-full-set-after', 'full-set', 'after'),
					edge('shares-before-settlement', 'before', 'settlement', 'recover collateral'),
					edge('shares-after-settlement', 'after', 'settlement', 'redeem payout'),
				],
			),
		],
	),
	'fig-statoblast-share-migration': diagram(
		{
			ariaDescription: 'On first materialization into untouched children, the full current parent balance materializes in each selected child token id while the source remains locked as an entitlement. Later calls mint only the unmaterialized delta for each child.',
			ariaLabel: 'Share migration materializes persistent branch entitlements',
			height: 310,
			width: 900,
		},
		[
			section(
				'share-migration',
				[node('parent', 'Parent token id', 'blue', ['full holder balance']), node('migration', 'migrate()', 'gold', ['record target delta', 'check sorted targets']), node('child-a', 'Child token A', 'green', ['first: full balance']), node('child-b', 'Child token B', 'green', ['first: full balance'])],
				[edge('migration-parent-call', 'parent', 'migration'), edge('migration-call-child-a', 'migration', 'child-a', 'materialize delta'), edge('migration-call-child-b', 'migration', 'child-b', 'materialize delta')],
			),
		],
	),
	'fig-statoblast-system-decision-flow': diagram(
		{
			ariaDescription: 'Question, pool, escalation, fork, child migration, auction repair, fixed-outcome settlement, and unresolved recursive continuation flow.',
			ariaLabel: 'Whole-system decision flow',
			height: 620,
			width: 940,
		},
		[
			section(
				'system-decision-input',
				[node('question', 'Question', 'blue', ['Zoltar registration']), node('pool', 'Security pool', 'green', ['security vaults + ETH shares']), node('game', 'Escalation game', 'red', ['Invalid, Yes, No balances']), node('decision', 'Decision point', 'gold', ['local winner or non-decision'])],
				[edge('system-question-pool', 'question', 'pool'), edge('system-pool-game', 'pool', 'game'), edge('system-game-decision', 'game', 'decision')],
				{ description: 'A question enters pool accounting and local REP-backed escalation', direction: 'DOWN', title: '1. Reach a decision' },
			),
			section(
				'system-decision-outcomes',
				[
					node('decision', 'Decision point', 'gold', ['local winner or non-decision']),
					node('local', 'Local settlement', 'green', ['redeem winning shares']),
					node('fork', 'Fork + migration', 'gold', ['child pools per outcome']),
					node('auction', 'Truth auction', 'gold', ['if collateral is short']),
					node('child', 'Operational child', 'green', ['fixed outcome may settle']),
					node('recursive', 'Unresolved child', 'slate', ['recursive continuation']),
				],
				[
					edge('system-decision-local', 'decision', 'local', 'local winner'),
					edge('system-decision-fork', 'decision', 'fork', 'non-decision'),
					edge('system-fork-auction', 'fork', 'auction', 'backing short'),
					edge('system-fork-child', 'fork', 'child', 'backing sufficient'),
					edge('system-auction-child', 'auction', 'child', 'repair settles'),
					edge('system-child-local', 'child', 'local', 'fixed outcome'),
					edge('system-child-recursive', 'child', 'recursive', 'unresolved'),
				],
				{ description: 'A local winner settles immediately; a non-decision continues through child repair and may recurse', direction: 'DOWN', title: '2. Settle or continue' },
			),
		],
	),
	'fig-zoltar-fork-branch-set': diagram(
		{
			ariaDescription: 'A fork creates the full valid branch set for Invalid and every valid outcome; the contract does not privilege a branch.',
			ariaLabel: 'A parent universe forks into children for Invalid and each valid outcome',
			height: 390,
			width: 920,
		},
		[
			section(
				'fork-branches',
				[node('parent', 'Parent universe', 'gold', ['fork on disputed question']), node('invalid', 'Invalid', 'teal'), node('outcome-1', 'Outcome 1', 'blue'), node('outcome-2', 'Outcome 2', 'blue'), node('outcome-n', 'Outcome N', 'blue')],
				[edge('branch-parent-invalid', 'parent', 'invalid', 'deterministic child id'), edge('branch-parent-one', 'parent', 'outcome-1'), edge('branch-parent-two', 'parent', 'outcome-2'), edge('branch-parent-n', 'parent', 'outcome-n')],
				{ direction: 'DOWN' },
			),
		],
	),
	'fig-zoltar-packed-scalar-answer': diagram(
		{
			ariaDescription: 'A scalar answer separates reserved bits, a namespace flag, and two payout fields. Bits 254 through 240 must be zero, bit 255 chooses Invalid or scalar value, and valid scalar payout fields must sum to numTicks.',
			ariaLabel: 'A uint256 scalar answer uses the highest bit as a namespace flag, then packs two 120-bit payout numerators',
			height: 640,
			width: 920,
		},
		[
			section(
				'packed-fields',
				[
					node('answer', 'uint256 answer', 'blue'),
					node('flag', 'bit 255', 'teal', ['namespace flag']),
					node('reserved', 'bits 254…240', 'red', ['reserved; must be zero']),
					node('first', 'bits 239…120', 'gold', ['first payout numerator']),
					node('second', 'bits 119…0', 'blue', ['second payout numerator']),
					node('invalid', 'Invalid namespace', 'red', ['flag = 0']),
					node('scalar', 'Scalar namespace', 'green', ['flag = 1']),
					node('validity', 'Scalar validity check', 'gold', ['first + second = numTicks']),
				],
				[
					edge('packed-answer-flag', 'answer', 'flag'),
					edge('packed-answer-reserved', 'answer', 'reserved'),
					edge('packed-answer-first', 'answer', 'first'),
					edge('packed-answer-second', 'answer', 'second'),
					edge('packed-flag-invalid', 'flag', 'invalid', '0'),
					edge('packed-flag-scalar', 'flag', 'scalar', '1'),
					edge('packed-first-validity', 'first', 'validity'),
					edge('packed-second-validity', 'second', 'validity'),
					edge('packed-scalar-validity', 'scalar', 'validity'),
				],
				{ direction: 'DOWN' },
			),
		],
	),
	'fig-zoltar-threshold-deposit': diagram(
		{
			ariaDescription: 'The full attoREP fork-threshold deposit leaves parent supply. After flooring the approximately twenty-percent uncredited haircut, the remainder becomes an approximately eighty-percent migration balance.',
			ariaLabel: 'Fork threshold deposit splits into an uncredited haircut and migration balance',
			height: 340,
			width: 860,
		},
		[
			section(
				'threshold-deposit',
				[node('deposit', 'Threshold deposit', 'blue', ['≈5% of theoretical REP supply'], 240), node('haircut', 'Uncredited haircut', 'red', ['≈20%', 'integer floor']), node('migration', 'Migration balance', 'green', ['≈80%', 'child-REP credit'])],
				[edge('threshold-deposit-haircut', 'deposit', 'haircut', 'forkThreshold / burnDivisor'), edge('threshold-deposit-migration', 'deposit', 'migration', 'deposit − haircut')],
			),
		],
	),
} satisfies Record<string, DiagramGraphSpec>
