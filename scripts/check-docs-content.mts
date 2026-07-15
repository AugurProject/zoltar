import assert from 'node:assert/strict'

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ')
const htmlToVisibleText = (text: string) =>
	text
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')

const htmlParagraphBodies = (text: string) => {
	const paragraphs: string[] = []
	for (const match of text.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
		const paragraph = match[1]
		if (paragraph !== undefined) {
			paragraphs.push(paragraph)
		}
	}
	return paragraphs
}

const markdownParagraphBodies = (text: string) =>
	text
		.split(/\n{2,}/)
		.map(paragraph => paragraph.trim())
		.filter(paragraph => paragraph.length > 0)

const discouragedDocsPatterns = [
	{
		name: 'meta page framing',
		regex: /\b(?:in\s+)?(this|these)\s+(page|pages|guide|guides|reference|references|document|documents|whitepaper|whitepapers|docs|table|tables),?\s+(explains|explain|describes|describe|maps|map|lists|list|keeps|keep|is|are|summarizes|summarize|usually)\b/i,
	},
	{
		name: 'these-docs framing',
		regex: /\b(?:in\s+)?these\s+docs\b/i,
	},
	{
		name: 'reader instruction',
		regex: /\b(?:read\s+(this|it|the|next)|start\s+with\s+(these|this|the)\s+words?)\b/i,
	},
	{
		name: 'use-this instruction',
		regex: /\buse\s+(this|the inputs|the table)\b/i,
	},
	{
		name: 'reader-framing label',
		regex: /\b(contracts to read|reader shortcut|first read|why readers should care)\b/i,
	},
	{
		name: 'document-subject framing',
		regex:
			/\b(white paper|white papers|whitepaper|whitepapers|reference|references|auction design|auction designs|guide|guides|document|documents|docs|page|pages|section|sections|sidebar|sidebars|table|tables)\s+(explains|explain|keeps|keep|summarizes|summarize|maps|map|describes|describe|lists|list|expands|expand|collects|collect|defines|define|is|are)\b/i,
	},
	{
		name: 'reader-question transition',
		regex: /\b(first|next|then|finally)\s+ask\b/i,
	},
	{
		name: 'vague core-idea framing',
		regex: /\b(the\s+)?core idea( is)?\b/i,
	},
	{
		name: 'wrong question lifecycle actor',
		regex:
			/\b(question|questions|forkQuestion)\s+(can|could|may|might|must|will|should|cannot|can't)?\s*(?:(?:already|later|safely|locally|globally|cleanly|\w+ly)\s+){0,3}(becomes?|escalates?|forks?|resolves?|trades?|settles?|settled|drives?|causes?|caused|triggers?|triggered)\b|\b(question|questions|forkQuestion)\s+(that|which|whose)\s+[^.]{0,80}\b(becomes?|escalates?|resolves?|trades?|settles?|settled|drives?|causes?|caused|triggers?|triggered)\b|\b(question|questions|forkQuestion)\s+(can|could|may|might|must|will|should)?\s*drive\s+[^.]{0,80}\bforks?\b|\b(question|questions|forkQuestion)\s+caused\s+[^.]{0,80}\bsplit\b|\b(question|questions|forkQuestion)\s+(can|could|may|might|must|will|should|cannot|can't|is|are|was|were|gets?|got)?\s*(?:(?:already|later|safely|locally|globally|cleanly|\w+ly)\s+){0,3}be\s+(?:(?:already|later|safely|locally|globally|cleanly|\w+ly)\s+){0,3}(resolved|forked|traded|escalated|settled)\b|\b(question|questions|forkQuestion)\s+(is|are|was|were|gets?|got)\s+(?:(?:already|later|safely|locally|globally|cleanly|\w+ly)\s+){0,3}(resolved|forked|traded|escalated|settled)\b/i,
	},
	{
		name: 'exhaustive child-pool creation',
		regex: /\bfor each fork branch\b/i,
	},
	{
		name: 'passive migration-balance grant',
		regex: /\bholder receives a\s+(?:migration balance|<em>migration balance<\/em>)\b/i,
	},
]

const findDiscouragedDocsWording = (path: string, text: string) => {
	const violations: string[] = []
	const checkLines = (label: string, checkedText: string) => {
		const lines = checkedText.split('\n')
		lines.forEach((line, index) => {
			for (const pattern of discouragedDocsPatterns) {
				if (pattern.regex.test(line)) {
					violations.push(`${path}:${label}:${index + 1}: ${pattern.name}: ${line.trim()}`)
				}
			}
		})
	}
	const checkNormalized = (label: string, checkedText: string) => {
		const normalizedText = normalizeWhitespace(checkedText)
		for (const pattern of discouragedDocsPatterns) {
			if (pattern.regex.test(normalizedText)) {
				violations.push(`${path}: ${label}: ${pattern.name}`)
			}
		}
	}

	checkLines('raw', text)
	checkNormalized('normalized', text)
	if (path.endsWith('.html')) {
		const visibleText = htmlToVisibleText(text)
		checkLines('visible', visibleText)
		checkNormalized('visible normalized', visibleText)
	}
	return violations
}

const findDefinitionPileups = (path: string, text: string) => {
	if (!path.endsWith('.html') && !path.endsWith('.md')) {
		return []
	}
	const violations: string[] = []
	const paragraphs = path.endsWith('.html') ? htmlParagraphBodies(text).map(paragraph => ({ raw: paragraph, visible: htmlToVisibleText(paragraph) })) : markdownParagraphBodies(text).map(paragraph => ({ raw: paragraph, visible: paragraph }))
	paragraphs.forEach((paragraph, index) => {
		const visibleText = normalizeWhitespace(paragraph.visible).trim()
		const emphasizedTerms = (paragraph.raw.match(/<em\b/gi)?.length ?? 0) + (paragraph.raw.match(/(?:^|[^*])\*[^*\n]+\*/g)?.length ?? 0)
		const definitionOpeners = visibleText.match(/\b(?:A|An|The)\s+[^.]{1,80}\s+(?:is|means|belongs to)\b/g)?.length ?? 0
		const semicolonCompression = /;\s+(?:it|this|they)\b/i.test(visibleText)
		const hasDefinitionPileup = definitionOpeners >= 4 || (emphasizedTerms >= 4 && definitionOpeners >= 2) || (emphasizedTerms >= 3 && definitionOpeners >= 1 && semicolonCompression)
		if (hasDefinitionPileup) {
			violations.push(`${path}:paragraph ${index + 1}: definition pileup: ${visibleText.slice(0, 160)}`)
		}
	})
	return violations
}

const docsGlob = new Bun.Glob('docs/**/*.{html,js,md}')
const paths = ['README.md']
for await (const path of docsGlob.scan('.')) {
	paths.push(path)
}

const wordingViolations: string[] = []
for (const path of paths.sort()) {
	const text = await Bun.file(path).text()
	wordingViolations.push(...findDiscouragedDocsWording(path, text))
	wordingViolations.push(...findDefinitionPileups(path, text))
}
assert.deepEqual(wordingViolations, [], 'Documentation contains discouraged meta framing or definition pileups')

const discouragedPatternFixtures = [
	{ expected: 'meta page framing', text: 'This\npage explains the lifecycle.' },
	{ expected: 'these-docs framing', text: 'These\ndocs describe the lifecycle.' },
	{ expected: 'reader instruction', text: 'Read this before the formulas.' },
	{ expected: 'use-this instruction', text: 'Use the inputs to explore the auction.' },
	{ expected: 'reader-framing label', text: 'Reader shortcut' },
	{ expected: 'document-subject framing', text: 'Auction design explains the lifecycle.' },
	{ expected: 'reader-question transition', text: 'First ask what moves collateral.' },
	{ expected: 'vague core-idea framing', text: 'The core idea is split responsibility.' },
	{ expected: 'wrong question lifecycle actor', text: 'the question can become a pool' },
	{ expected: 'wrong question lifecycle actor', text: 'question is forked' },
	{ expected: 'wrong question lifecycle actor', text: 'the question cannot settle locally' },
	{ expected: 'wrong question lifecycle actor', text: '<p><code>forkQuestion</code> triggered a fork.</p>', path: 'docs/example.html' },
	{ expected: 'exhaustive child-pool creation', text: 'Placeholder creates one child pool for each fork branch.' },
	{ expected: 'passive migration-balance grant', text: '<p>After a fork, a holder receives a <em>migration balance</em>.</p>', path: 'docs/example.html' },
]

for (const fixture of discouragedPatternFixtures) {
	const violations = findDiscouragedDocsWording(fixture.path ?? 'docs/example.md', fixture.text)
	assert.ok(
		violations.some(violation => violation.includes(fixture.expected)),
		`${fixture.expected} fixture should be detected`,
	)
}

assert.ok(
	findDefinitionPileups(
		'docs/example.html',
		`
			<p>
				A <em>fork</em> is a split. A <em>fork branch</em> is one path.
				A <em>child pool</em> is a pool in that branch. A
				<em>truth auction</em> is a repair sale after a fork; it does not
				choose truth.
			</p>
		`,
	).length > 0,
	'definition pileup fixture should be detected',
)

const whitepaper = await Bun.file('docs/placeholder-whitepaper.html').text()
const openOracleIntegration = await Bun.file('docs/open-oracle-integration.html').text()
const operatorReference = await Bun.file('docs/operator-reference.md').text()
const escalationGameArchitecture = await Bun.file('docs/escalation-game-architecture.html').text()
const startHere = await Bun.file('docs/start-here.html').text()
const sharedDocsCss = await Bun.file('docs/shared-docs.css').text()
const uiCopyModuleGlob = new Bun.Glob('ui/ts/copy/*.ts')
let uiCopy = ''
for await (const path of uiCopyModuleGlob.scan('.')) {
	uiCopy += await Bun.file(path).text()
}
const recursiveContinuationFigure = whitepaper.match(/<figure class="diagram" id="fig-placeholder-recursive-continuation">[\s\S]*?<\/figure>/)?.[0] ?? ''
const ownForkBucketFigure = whitepaper.match(/<figure class="diagram" id="fig-placeholder-own-fork-rep-buckets">[\s\S]*?<\/figure>/)?.[0] ?? ''
assert.match(whitepaper, /PRICE_VALID_FOR_SECONDS = 5 minutes/)
assert.match(whitepaper, /<td><code>PRICE_VALID_FOR_SECONDS<\/code><\/td>\s*<td><code>5 minutes<\/code><\/td>/)
assert.match(whitepaper, /OpenOracle <code>settlementTime<\/code><\/td>\s*<td>\s*<math aria-label="40 times 12" data-source="40 \\cdot 12"/)
assert.match(whitepaper, /<code>480 seconds \(8 minutes\)<\/code>/)
assert.match(whitepaper, /the configured OpenOracle <code>timeType<\/code> uses\s+seconds/)
assert.match(openOracleIntegration, /<code>480 seconds \(8 minutes\)<\/code>/)
assert.match(openOracleIntegration, /the configured OpenOracle <code>timeType<\/code> uses seconds/)
assert.ok(!whitepaper.includes('PRICE_VALID_FOR_SECONDS = 1 hour'))
assert.ok(!whitepaper.includes('Settlement delay encoded as <code>15 \\cdot 12</code>.'))

assert.match(whitepaper, /<code>1 REP<\/code> default deployment value/)
assert.match(whitepaper, /<td><code>initialEscalationGameDeposit<\/code><\/td>\s*<td><code>1 REP<\/code> default<\/td>/)
assert.match(whitepaper, /<code>1000000000000000000<\/code> atomic REP units/)
assert.ok(!/initialEscalationGameDeposit[\s\S]{0,200}<code>1 ether<\/code>/.test(whitepaper))
assert.match(whitepaper, /Every selected continuation receives the complete parent game snapshot\.[\s\S]{0,320}materializes only the\s+calling vault's aggregate claim authorization in that child\./)
assert.match(operatorReference, /\| Canonical continuation snapshot \| Fork initialization stores the complete parent `Invalid`\/`Yes`\/`No` balances, carry totals, peaks, leaf counts, and nullifier roots once\./)
assert.match(operatorReference, /\| Aggregate escalation backing \| An external fork locks the drained game's complete REP[ -￿]*?one-for-one[ -￿]*?An own fork[ -￿]*?post-burn `escalationChildRepAtFork` bucket/)
assert.ok(!operatorReference.includes("locks the escalation game's complete physical REP"))
assert.match(operatorReference, /\| Direct-claim replay protection \| A successful direct own-fork claim records the stable parent deposit identity once\./)
assert.match(operatorReference, /The lookup walks the current pool's parent lineage/)
assert.match(operatorReference, /\| Vault-selected materialization \| Only the affected vault may materialize its aggregate unresolved entitlement/)
assert.match(operatorReference, /\| Vault entitlement status \| `getEscalationMigrationEntitlementStatus` reports whether a vault captured its aggregate entitlement/)
assert.match(operatorReference, /\| Independent continuation liveness \| A child becomes operational and resumes without waiting for every parent vault/)
assert.match(whitepaper, /Migration exports per-vault\s+principal as exactly three outcome totals/)
assert.match(whitepaper, /child carry and aggregate backing initialization are independent of vault escrow materialization/)
assert.match(whitepaper, /Neither route makes\s+vault export responsible for constructing the child carry snapshot/)
assert.match(whitepaper, /Child creation may happen permissionlessly in an earlier transaction or at the[\s\S]{0,280}delegate captures and materializes the entitlement atomically/)
assert.ok(!whitepaper.includes('Either may happen first'))
assert.match(whitepaper, /public <code>SecurityPoolForker\.migrateVaultWithUnresolvedEscalation<\/code>[\s\S]{0,180}ordinary vault migration[\s\S]{0,180}delegates entitlement capture and materialization/)
assert.match(whitepaper, /one selected child per call/)
assert.ok(!whitepaper.includes('selected child only'))
assert.match(whitepaper, /<td>Record vault escrow<\/td>[\s\S]{0,300}vault-specific escrow in one selected child/)
assert.match(whitepaper, /Every selected child reads the same canonical snapshot even if an allowed parent claim occurs before late child creation/)
assert.match(whitepaper, /the direct-claim replay check walks the pool's parent lineage/)
assert.match(escalationGameArchitecture, /Aggregate vault export<\/td>[\s\S]{0,360}clears only the vault's three outcome aggregates and escrow counters/)
assert.ok(!escalationGameArchitecture.includes('Settlement, claim, or export must zero the amount'))
assert.match(escalationGameArchitecture, /individual deposit rows remain only as canonical proof material[\s\S]{0,180}no\s+longer represent parent logical authorization or physical escrow/)
assert.ok(!escalationGameArchitecture.includes('A local deposit stays active while'))
assert.match(escalationGameArchitecture, /Before aggregate export,[\s\S]{0,120}Deposit\.amount[\s\S]{0,180}localUnresolvedTotalsExportedByVault\[vault\][\s\S]{0,180}canonical proof material only, not active parent locks/)
assert.ok(!whitepaper.includes('parent deposit rows are cleared'))
assert.ok(!operatorReference.includes('parent deposit rows are cleared'))
assert.match(whitepaper, /three per-vault aggregate rows and parent vault escrow[\s\S]{0,80}counters are cleared[\s\S]{0,100}Individual deposit rows remain canonical proof material/)
assert.match(whitepaper, /Current balances, carry, and nullifiers form the canonical next[\s\S]{0,240}Remaining aggregate REP separately funds physical child[\s\S]{0,240}Vault outcome aggregates separately become a stored/)
assert.ok(!whitepaper.includes('forked escrow combine into the next fork snapshot'))
assert.match(whitepaper, /Three independent unresolved escalation migration lanes/)
assert.match(whitepaper, /Canonical snapshot state initializes the selected child's proof baseline[\s\S]{0,180}Aggregate REP separately supplies physical child backing[\s\S]{0,180}Vault-specific[\s\S]{0,80}stored entitlement and logical escrow/)
assert.ok(!whitepaper.includes('all totals + MMR + pooled REP'))
assert.ok(!recursiveContinuationFigure.includes('canonical snapshot + REP lock'))
assert.match(recursiveContinuationFigure, /Canonical snapshot state supplies each selected[\s\S]{0,160}aggregate REP separately supplies physical backing[\s\S]{0,160}stored entitlement separately supplies logical escrow/)
assert.match(whitepaper, /An external fork moves the drained game's complete REP one-for-one[\s\S]{0,180}An own fork combines pool and game REP before the burn and stores the complete post-burn <code>escalationChildRepAtFork<\/code> bucket/)
assert.ok(!whitepaper.includes("Moves the game's complete physical REP into the pool-specific migration balance once"))
assert.match(whitepaper, /Reproduces the complete aggregate escalation backing into that selected child exactly once/)
assert.ok(!ownForkBucketFigure.includes('Escrow Bucket'))
assert.ok(!ownForkBucketFigure.includes('unresolved escalation escrow'))
assert.match(ownForkBucketFigure, /aggregate escalation-backing buckets[\s\S]{0,180}Vault-specific logical escrow is created separately and is not shown/)
assert.match(whitepaper, /The game clears and returns one aggregate principal tuple without transferring REP; the forker stores the returned entitlement/)
assert.match(whitepaper, /exposes the captured state and all three[\s\S]{0,120}per-outcome materialization flags/)
assert.match(whitepaper, /vaultRepAtFork = totalRepBeforeBurn == 0 \? 0 : floor\(poolRepToFork \\cdot auctionableRepAtFork \/ totalRepBeforeBurn\)/)
assert.match(whitepaper, /vaultEscrowChildRep = floor\(sourceRepAmount \\cdot escalationChildRepAtFork \/ escalationSourceRepAtFork\)/)
assert.match(whitepaper, /sourceRepAmount[\s\S]{0,220}current REP represented by an[\s\S]{0,220}sourcePrincipal[\s\S]{0,120}separate logical quantity/)
assert.match(whitepaper, /current nullifier roots after any prior proof[\s\S]{0,180}remaining aggregate physical REP/)
assert.match(whitepaper, /Each selected grandchild receives that same canonical snapshot and[\s\S]{0,120}full remaining aggregate backing once/)
assert.match(whitepaper, /external-fork example, source REP converts to child REP[\s\S]{0,80}one-for-one[\s\S]{0,520}<code>20 REP<\/code>/)
assert.match(whitepaper, /Every[\s\S]{0,40}current or later-created child checks that parent-wide record before[\s\S]{0,180}same-outcome deposit's aggregate logical/)
assert.match(operatorReference, /getOwnForkRepBuckets` reports the fixed escalation child REP available independently to each selected outcome/)
assert.match(whitepaper, /Vault owners with unresolved escalation locks captured by either an own\s+or external fork call/)
assert.match(startHere, /its three aggregate outcome totals\s+for <code>Invalid<\/code>, <code>Yes<\/code>, and <code>No<\/code>/)
assert.match(startHere, /A selected continuation can start without waiting for inactive vaults\. It copies\s+the complete parent escalation totals/)
assert.match(startHere, /A selected continuation can start without waiting for inactive vaults[\s\S]{0,260}External forks reproduce[\s\S]{0,100}one-for-one[\s\S]{0,140}own forks reproduce the complete post-burn/)
assert.ok(!startHere.includes('Every continuation that a vault chooses to create'))
assert.ok(!startHere.includes('aggregate outcome balances'))
assert.match(sharedDocsCss, /body\.doc-openoracle \.diagram-wide > svg\s*{\s*min-width: 60rem;\s*}/)
assert.doesNotMatch(sharedDocsCss, /body\.doc-openoracle svg text\.svg-(?:label|small)\s*{\s*font-size:/)
assert.match(operatorReference, /A vault that makes no call before the deadline keeps its unresolved parent lock and has no logical child escrow[\s\S]{0,260}unselected children likewise have no escrow authorization for that vault/)
assert.ok(!whitepaper.includes('MAX_UNRESOLVED_EXPORT_REFS'))
assert.ok(!whitepaper.includes('Paged Export'))
assert.ok(!operatorReference.includes('Local carry batching'))
assert.match(whitepaper, /snapshots preserve the parent balances exactly, including tied maxima\s+below <code>nonDecisionThreshold<\/code>/)
assert.match(operatorReference, /Continuation snapshots preserve the parent balances exactly, including ties/)
assert.match(uiCopy, /stored entitlement can be reused in any additional child universe/)
assert.match(uiCopy, /remains available for other unselected child outcomes until the migration deadline/)
assert.ok(!uiCopy.includes('They cannot be split across multiple outcomes.'))

const protocolTerms = await Bun.file('docs/protocolTerms.js').text()
assert.match(protocolTerms, /const repEthPriceDefinition/)
assert.match(protocolTerms, /The REP cost of 1 ETH/)
assert.match(protocolTerms, /A higher value means ETH is more expensive in REP terms/)
assert.match(protocolTerms, /A delayed action that cannot run until the coordinator has a fresh REP\/ETH price\./)
assert.match(protocolTerms, /'bond allowance': 'The amount of REP-backed security-bond exposure a vault currently permits\.'/)
assert.match(protocolTerms, /'security-bond allowance': 'The current amount of REP-backed exposure a vault allows the pool or coordinator to use\.'/)
assert.match(protocolTerms, /'split migration rep': 'The action that mints a chosen amount of child REP in each selected child universe, capped per child by the caller migration balance\. This is reproduction, not pro-rata splitting\.'/)
assert.match(protocolTerms, /repPerEthPrice: repEthPriceDefinition/)
assert.match(protocolTerms, /'rep\/eth price': repEthPriceDefinition/)
