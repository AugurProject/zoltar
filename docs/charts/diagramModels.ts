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

export const diagramGraphSpecs = {
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
					node('deposit-leaf', 'Deposit leaf', 'blue', ['global leafIndex']),
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
				[node('eth', 'User sends ETH', 'blue'), node('full-set', 'Receives full set', 'green', ['Invalid + Yes + No']), node('operational', 'While operational', 'teal', ['burn full set']), node('finalized', 'After finalization', 'gold', ['winning leg redeems']), node('settlement', 'Collateral settlement', 'slate')],
				[
					edge('shares-eth-full-set', 'eth', 'full-set', 'portfolio purchase'),
					edge('shares-full-set-operational', 'full-set', 'operational'),
					edge('shares-full-set-finalized', 'full-set', 'finalized'),
					edge('shares-operational-settlement', 'operational', 'settlement', 'recover collateral'),
					edge('shares-finalized-settlement', 'finalized', 'settlement', 'redeem payout'),
				],
			),
		],
	),
	'fig-statoblast-system-decision-flow': diagram(
		{
			ariaDescription: 'A portfolio shares capital across registered questions. Each question can resolve locally. A universe fork uses one owner choice per portfolio, shared branch accounting and auctions where needed, then prepares individual child questions on demand.',
			ariaLabel: 'Shared portfolio and question lifecycle',
			height: 620,
			width: 940,
		},
		[
			section(
				'portfolio-questions',
				[node('capital', 'Portfolio capital', 'blue', ['individual owner commitments']), node('questions', 'Registered questions', 'green', ['separate shares and cash']), node('reports', 'Question reporting', 'gold', ['wallet REP deposits']), node('local', 'Local resolution', 'green', ['winning shares redeem'])],
				[edge('capital-questions', 'capital', 'questions', 'shared backing'), edge('questions-reports', 'questions', 'reports'), edge('reports-local', 'reports', 'local', 'resolved outcome')],
				{ title: 'Question settlement' },
			),
			section(
				'portfolio-forks',
				[node('fork', 'Universe fork', 'red', ['local non-decision or another question']), node('choices', 'Shared owner choices', 'gold', ['one per portfolio and universe']), node('branch', 'Branch accounting', 'blue', ['auction where ETH is short']), node('child', 'Child questions', 'green', ['prepare on demand'])],
				[edge('fork-choices', 'fork', 'choices'), edge('choices-branch', 'choices', 'branch', 'after choice cutoff'), edge('branch-child', 'branch', 'child', 'settle or continue')],
				{ title: 'Shared fork recovery' },
			),
		],
	),
	'fig-zoltar-fork-branch-set': diagram(
		{
			ariaDescription: 'For a binary market example, a fork creates Invalid, Yes, and No child universes; the contract does not privilege a branch.',
			ariaLabel: 'The parent universe for a binary market question forks into Invalid, Yes, and No child universes',
			height: 390,
			width: 920,
		},
		[
			section(
				'fork-branches',
				[node('parent', 'Parent universe', 'gold', ['Fork question']), node('invalid', 'Invalid', 'teal'), node('yes', 'Yes', 'blue'), node('no', 'No', 'blue')],
				[edge('branch-parent-invalid', 'parent', 'invalid', 'deterministic child id'), edge('branch-parent-yes', 'parent', 'yes'), edge('branch-parent-no', 'parent', 'no')],
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
