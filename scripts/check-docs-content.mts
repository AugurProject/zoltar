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

const parsedHtmlParagraphBodies = async (text: string, excludedContainers = 'script, style, template, noscript') => {
	const paragraphs: string[] = []
	let excludedDepth = 0
	let currentParagraph: string[] | undefined
	const rewriter = new HTMLRewriter()
		.on(excludedContainers, {
			element(element) {
				excludedDepth += 1
				element.onEndTag(() => {
					excludedDepth -= 1
				})
			},
		})
		.on('p', {
			element(element) {
				if (excludedDepth > 0) {
					return
				}
				const paragraph: string[] = []
				currentParagraph = paragraph
				element.onEndTag(() => {
					paragraphs.push(paragraph.join(''))
					if (currentParagraph === paragraph) {
						currentParagraph = undefined
					}
				})
			},
			text(chunk) {
				if (excludedDepth === 0) {
					currentParagraph?.push(chunk.text)
				}
			},
		})
	await rewriter.transform(new Response(text)).text()
	return paragraphs
}

const parsedHtmlFormulaSources = async (text: string) => {
	const formulas: string[] = []
	let excludedDepth = 0
	const rewriter = new HTMLRewriter()
		.on('script, style, template, noscript', {
			element(element) {
				excludedDepth += 1
				element.onEndTag(() => {
					excludedDepth -= 1
				})
			},
		})
		.on('math[data-source]', {
			element(element) {
				if (excludedDepth > 0) {
					return
				}
				const formula = element.getAttribute('data-source')
				if (formula !== null) {
					formulas.push(formula)
				}
			},
		})
	await rewriter.transform(new Response(text)).text()
	return formulas
}

const renderedMarkdownParagraphBodies = (text: string) => parsedHtmlParagraphBodies(Bun.markdown.html(text), 'script, style, template, noscript, pre, table, li')

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

const findDefinitionPileups = async (path: string, text: string) => {
	if (!path.endsWith('.html') && !path.endsWith('.md')) {
		return []
	}
	const violations: string[] = []
	const paragraphs = path.endsWith('.html') ? htmlParagraphBodies(text).map(paragraph => ({ raw: paragraph, visible: htmlToVisibleText(paragraph) })) : (await renderedMarkdownParagraphBodies(text)).map(paragraph => ({ raw: paragraph, visible: paragraph }))
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

const normalizeDuplicateSyntax = (text: string) =>
	normalizeWhitespace(text)
		.toLowerCase()
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/\\(?:cdot|times)\b/g, '*')
		.replace(/\\(?:neq|ne)\b/g, '!=')
		.replace(/\\(?:lor|vee)\b|\|\|/g, ' or ')
		.replace(/\\(?:land|wedge)\b|&&/g, ' and ')
		.replace(/[×·⋅]/g, '*')
		.replace(/÷/g, '/')
		.replace(/[−–—]/g, '-')
		.replace(/≤/g, '<=')
		.replace(/≥/g, '>=')

const normalizeDuplicateCandidate = (text: string) =>
	normalizeDuplicateSyntax(text)
		.replace(/[^a-z0-9_=+\-*/<>^?:.%&|!]+/g, ' ')
		.replace(/\s*([_=+\-*/<>^?:%&|!])\s*/g, ' $1 ')
		.replace(/\s+/g, ' ')
		.trim()

const normalizeDuplicateFormula = (text: string) =>
	normalizeDuplicateSyntax(text)
		.replace(/[^a-z0-9_=+\-*/<>^?:.%()[\],&|!]+/g, ' ')
		.replace(/\s*([_=+\-*/<>^?:%()[\],&|!])\s*/g, ' $1 ')
		.replace(/\s+/g, ' ')
		.trim()

assert.equal(normalizeDuplicateFormula('result = a + b + c + d + e'), normalizeDuplicateFormula(' RESULT=a+b+c+d+e '), 'formula duplicate normalization should ignore formatting differences')
assert.notEqual(normalizeDuplicateFormula('result = a + b + c + d + e'), normalizeDuplicateFormula('result = a - b - c - d - e'), 'formula duplicate normalization should preserve operator differences')
assert.notEqual(normalizeDuplicateFormula('a != b'), normalizeDuplicateFormula('a = b'), 'formula duplicate normalization should preserve inequality')
assert.equal(normalizeDuplicateFormula('result = a \\cdot b \\times c'), normalizeDuplicateFormula('result = a * b * c'), 'formula duplicate normalization should unify multiplication notation')
assert.equal(normalizeDuplicateFormula('result = a || b && c'), normalizeDuplicateFormula('result = a or b and c'), 'formula duplicate normalization should preserve and normalize logical operators')
assert.notEqual(normalizeDuplicateCandidate('the guard requires a > b'), normalizeDuplicateCandidate('the guard requires a < b'), 'paragraph duplicate normalization should preserve comparison direction')
assert.notEqual(normalizeDuplicateCandidate('the guard requires a != b'), normalizeDuplicateCandidate('the guard requires a = b'), 'paragraph duplicate normalization should preserve inequality')

type DuplicateBlockMap = Map<string, string[]>

const recordDuplicateCandidate = (blocks: DuplicateBlockMap, path: string, label: string, text: string, minimumWords: number, normalize = normalizeDuplicateCandidate) => {
	const normalized = normalize(text)
	if (normalized.split(' ').length < minimumWords) {
		return
	}
	const locations = blocks.get(normalized) ?? []
	locations.push(`${path}:${label}`)
	blocks.set(normalized, locations)
}

const duplicateParagraphBodies = async (path: string, text: string) => {
	if (path.endsWith('.html')) {
		return parsedHtmlParagraphBodies(text)
	}
	if (path.endsWith('.md')) {
		return renderedMarkdownParagraphBodies(text)
	}
	return []
}

const recordDuplicateParagraphs = async (blocks: DuplicateBlockMap, path: string, text: string) => (await duplicateParagraphBodies(path, text)).forEach((paragraph, index) => recordDuplicateCandidate(blocks, path, `paragraph ${index + 1}`, paragraph, 18))

const duplicateDetectorFixtureBlocks: DuplicateBlockMap = new Map()
const duplicateDetectorFixture = 'Canonical duplication fixtures preserve meaningful operators while ignoring ordinary sentence punctuation across the rendered documentation sources reviewed by this content check.'
await recordDuplicateParagraphs(duplicateDetectorFixtureBlocks, 'docs/example.html', `<script>const embedded = ${JSON.stringify(`<p>${duplicateDetectorFixture}</p>`)}</script><template><p>${duplicateDetectorFixture}</p></template><p>${duplicateDetectorFixture}<script>${duplicateDetectorFixture}</script></p>`)
await recordDuplicateParagraphs(duplicateDetectorFixtureBlocks, 'docs/example.md', `${duplicateDetectorFixture}\n\n\`\`\`html\n<p>${duplicateDetectorFixture}</p>\n\`\`\`\n\n| Example |\n| --- |\n| ${duplicateDetectorFixture} |\n\n- ${duplicateDetectorFixture}`)
await recordDuplicateParagraphs(duplicateDetectorFixtureBlocks, 'docs/example.js', `export const example = '${duplicateDetectorFixture}'`)
assert.deepEqual(Array.from(duplicateDetectorFixtureBlocks.values()), [['docs/example.html:paragraph 1', 'docs/example.md:paragraph 1']], 'duplicate paragraph detection should compare rendered HTML and Markdown prose but ignore JavaScript source')

const inlineCodeFixtureBlocks: DuplicateBlockMap = new Map()
const inlineCodeFixturePrefix = 'Rendered duplication candidates retain the inline identifier'
const inlineCodeFixtureSuffix = 'while comparing otherwise identical technical paragraphs across HTML and Markdown documentation sources.'
await recordDuplicateParagraphs(inlineCodeFixtureBlocks, 'docs/inline-example.html', `<p>${inlineCodeFixturePrefix} <code>alphaLimit</code> ${inlineCodeFixtureSuffix}</p>`)
await recordDuplicateParagraphs(inlineCodeFixtureBlocks, 'docs/inline-example.md', `${inlineCodeFixturePrefix} \`alphaLimit\` ${inlineCodeFixtureSuffix}`)
await recordDuplicateParagraphs(inlineCodeFixtureBlocks, 'docs/distinct-inline-example.md', `${inlineCodeFixturePrefix} \`betaLimit\` ${inlineCodeFixtureSuffix}`)
assert.deepEqual(Array.from(inlineCodeFixtureBlocks.values()), [['docs/inline-example.html:paragraph 1', 'docs/inline-example.md:paragraph 1'], ['docs/distinct-inline-example.md:paragraph 1']], 'duplicate paragraph detection should align HTML and Markdown inline code while preserving identifier differences')

const duplicateDetectorFormulaFixture = 'result = a + b + c + d + e'
assert.deepEqual(
	await parsedHtmlFormulaSources(`<script>const embedded = ${JSON.stringify(`<math data-source="${duplicateDetectorFormulaFixture}"></math>`)}</script><template><math data-source="${duplicateDetectorFormulaFixture}"></math></template><math data-source="${duplicateDetectorFormulaFixture}"></math>`),
	[duplicateDetectorFormulaFixture],
	'formula duplicate detection should inspect rendered MathML but ignore script and template sources',
)

const duplicateBlocks: DuplicateBlockMap = new Map()

const docsGlob = new Bun.Glob('docs/**/*.{html,js,md}')
const paths = ['README.md']
for await (const path of docsGlob.scan('.')) {
	paths.push(path)
}

const wordingViolations: string[] = []
for (const path of paths.sort()) {
	const text = await Bun.file(path).text()
	wordingViolations.push(...findDiscouragedDocsWording(path, text))
	wordingViolations.push(...(await findDefinitionPileups(path, text)))
	await recordDuplicateParagraphs(duplicateBlocks, path, text)
	if (path.endsWith('.html')) {
		;(await parsedHtmlFormulaSources(text)).forEach((formula, index) => recordDuplicateCandidate(duplicateBlocks, path, `formula ${index + 1}`, formula, 6, normalizeDuplicateFormula))
	}
}
assert.deepEqual(wordingViolations, [], 'Documentation contains discouraged meta framing or definition pileups')

const duplicateViolations = Array.from(duplicateBlocks.values())
	.filter(locations => new Set(locations.map(location => location.split(':')[0])).size > 1)
	.map(locations => locations.join(', '))
assert.deepEqual(duplicateViolations, [], 'Documentation repeats the same paragraph or formula across files; keep one canonical owner and link to it')

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
	{ expected: 'exhaustive child-pool creation', text: 'Statoblast creates one child pool for each fork branch.' },
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
	(
		await findDefinitionPileups(
			'docs/example.html',
			`
			<p>
				A <em>fork</em> is a split. A <em>fork branch</em> is one path.
				A <em>child pool</em> is a pool in that branch. A
				<em>truth auction</em> is a repair sale after a fork; it does not
				choose truth.
			</p>
		`,
		)
	).length > 0,
	'definition pileup fixture should be detected',
)

const whitepaper = await Bun.file('docs/statoblast-whitepaper.html').text()
const zoltarWhitepaper = await Bun.file('docs/zoltar-whitepaper.html').text()
const openOracleIntegration = await Bun.file('docs/open-oracle-integration.html').text()
const operatorReference = await Bun.file('docs/operator-reference.md').text()
const escalationGameArchitecture = await Bun.file('docs/escalation-game-architecture.html').text()
const invariantsHtml = await Bun.file('docs/invariants.html').text()
const startHere = await Bun.file('docs/documentation.html').text()
const sharedDocsCss = await Bun.file('docs/shared-docs.css').text()
const uiCopyModuleGlob = new Bun.Glob('ui/ts/copy/*.ts')
let uiCopy = ''
for await (const path of uiCopyModuleGlob.scan('.')) {
	uiCopy += await Bun.file(path).text()
}
assert.match(openOracleIntegration, /<code>480 seconds \(8 minutes\)<\/code>/)
assert.match(openOracleIntegration, /the configured OpenOracle <code>timeType<\/code> uses seconds/)
assert.match(whitepaper, /<h2>11\. Parameter Sources<\/h2>/)
assert.match(whitepaper, /open-oracle-integration\.html#parameters/)
assert.match(whitepaper, /truth-auction\.html#lifecycle/)
assert.match(whitepaper, /liquidation\.html#punitive-liquidation/)
assert.doesNotMatch(whitepaper, /PRICE_VALID_FOR_SECONDS = 5 minutes/)
assert.doesNotMatch(whitepaper, /<code>480 seconds \(8 minutes\)<\/code>/)
assert.doesNotMatch(whitepaper, /data-source="requestPriceEthCost =/)
assert.doesNotMatch(whitepaper, /id="auction-clearing-example"|id="underfunded-auction-example"/)
assert.match(operatorReference, /security-model\.html#auction-a1/)
assert.match(operatorReference, /security-model\.html#oracle-a1/)
assert.match(operatorReference, /open-oracle-integration\.html#parameters/)
assert.match(operatorReference, /truth-auction\.html#clearing/)
assert.match(operatorReference, /open-oracle-integration\.html#intentional-economic-tradeoffs/)
assert.match(operatorReference, /open-oracle-integration\.html#attack-model/)
assert.doesNotMatch(operatorReference, /requestPriceEthCost =|qualification threshold is `ceil|rounded cumulative allocations|cap-implied qualification threshold|multiplier `115`|one through six wei/)
assert.match(whitepaper, /Every selected continuation receives the complete parent game snapshot\.[\s\S]{0,420}complete game REP[\s\S]{0,160}post-haircut game REP/)
assert.match(operatorReference, /\| Canonical continuation snapshot \| Fork initialization stores the complete parent `Invalid`\/`Yes`\/`No` balances, carry totals, peaks, leaf counts, and nullifier roots once\./)
assert.match(operatorReference, /\| Aggregate escalation backing \| An external unrelated fork locks the drained game's complete REP[\s\S]*?one-for-one[\s\S]*?own fork deducts the configured fork haircut/)
assert.match(operatorReference, /\| Direct-claim replay protection \| A successful direct own-fork claim records both the stable parent deposit identity and cumulative claimed principal by outcome\./)
assert.match(operatorReference, /effective inherited principal subtracts immediate-parent direct claims/)
assert.match(operatorReference, /\| Optional vault cleanup \| See \[Optional parent-lock cleanup\]\(#escalation-resolution-and-deposits\)[\s\S]*?never processes another vault/)
assert.doesNotMatch(operatorReference, /\| Optional vault cleanup \| The public `migrateVaultWithUnresolvedEscalation` wrapper first runs ordinary migration/)
assert.match(operatorReference, /External fork withdrawal lock[\s\S]*?winning inherited deposits settle there by proof[\s\S]*?inherited losers require no transaction[\s\S]*?parent lock accounting is optional/)
assert.match(operatorReference, /winning proofs can be relayed permissionlessly, inherited losers retire without proofs/)
assert.match(whitepaper, /escalation's own fork has already removed the winner haircut[\s\S]{0,120}does not burn it again/)
assert.match(whitepaper, /zoltar-whitepaper\.html#global-question-scope[\s\S]{0,220}consequence is universe-wide[\s\S]{0,180}parent flows for every pool/)
assert.doesNotMatch(whitepaper, /Zoltar imposes no separate creation-age[\s\S]{0,500}unnecessary fork delays every\s+pool/)
assert.match(zoltarWhitepaper, /REP threshold and haircut are the intended admission cost[\s\S]{0,220}unnecessary forks/)
assert.match(whitepaper, /local withdrawal, own-fork direct\s+claims, optional parent-lock cleanup, and child proof claims/)
assert.match(whitepaper, /migrateVault[\s\S]{0,160}whether or\s+not unresolved external-fork escalation locks exist[\s\S]{0,100}cleanup remains a separate optional concern/)
assert.match(whitepaper, /local game reaches a final outcome without non-decision[\s\S]{0,100}ordinary\s+no-fork lifecycle/)
assert.match(whitepaper, /Settlement does not re-mint that ownership[\s\S]{0,100}ordinary winning payout as wallet REP[\s\S]{0,100}losing\s+settlement clears escrow without a payout/)
assert.match(whitepaper, /own-fork direct claim[\s\S]{0,100}same winning reward math[\s\S]{0,100}pre-funded child REP[\s\S]{0,160}not a claim-time conversion[\s\S]{0,80}does not mint child-pool\s+ownership/)
assert.match(whitepaper, /href="#migration">Forks and Migration<\/a>[\s\S]{0,220}only distinguishes[\s\S]{0,120}settlement entry points/)
assert.match(whitepaper, /operator-reference\.md#escalation-resolution-and-deposits/)
assert.doesNotMatch(whitepaper, /id="fig-statoblast-unresolved-migration"|Unresolved Escalation Continuation Trace/)
assert.match(whitepaper, /forkHaircut = floor\(forkThreshold \/ forkBurnDivisor\); escalationChildRepAtFork = escalationRepToFork - forkHaircut; vaultRepAtFork = auctionableRepAtFork - escalationChildRepAtFork; selectedChildEscalationBacking = escalationChildRepAtFork/)
assert.match(whitepaper, /Each\s+selected grandchild receives that same canonical snapshot and full remaining[\s\S]{0,80}backing once; winning proofs remain their own authorization/)
assert.match(whitepaper, /external-fork example, source REP converts to child REP[\s\S]{0,80}one-for-one[\s\S]{0,520}<code>20 REP<\/code>/)
assert.match(startHere, /statoblast-whitepaper\.html#migration/)
assert.match(startHere, /merkle-mountain-range\.html/)
assert.match(escalationGameArchitecture, /Optional parent-vault cleanup stays constant-size because it clears three outcome totals without scanning deposit history/)
assert.match(escalationGameArchitecture, /Child continuation claims use aggregate game backing rather than copied per-vault escrow/)
assert.match(invariantsHtml, /<code>ESC-06<\/code>[\s\S]*?href="\.\.\/solidity\/contracts\/peripherals\/EscalationGameEscrow\.sol"[\s\S]*?<code>exportVaultUnresolvedTotalsWithoutTransfer<\/code>[\s\S]*?<code>ESC-07<\/code>/)
assert.ok(!whitepaper.includes('MAX_UNRESOLVED_EXPORT_REFS'))
assert.ok(!whitepaper.includes('Paged Export'))
assert.ok(!operatorReference.includes('Local carry batching'))
for (const obsoleteClaim of ['vaultEscrowChildRep', 'forked-escrow-scaling', 'forked-escrow-example', 'only materialized vault escrow authorizes proofs', 'Vault-selected materialization', 'Forked escrow scaling']) {
	assert.ok(!whitepaper.includes(obsoleteClaim), `Whitepaper retains obsolete continuation claim: ${obsoleteClaim}`)
	assert.ok(!operatorReference.includes(obsoleteClaim), `Operator reference retains obsolete continuation claim: ${obsoleteClaim}`)
}
assert.match(uiCopy, /First migrates this wallet’s unlocked vault ownership, allowance, fees, and collateral to the selected child/)
assert.match(uiCopy, /not required to fund escalation backing or claim a winning carried proof/)
assert.match(uiCopy, /inherited losers require no claim transaction/)
assert.match(uiCopy, /Child backing and proof eligibility were already available and are unchanged/)
assert.match(uiCopy, /Unclaimed winners can instead settle from aggregate child backing with a proof/)
assert.match(uiCopy, /only winning positions can be settled; inherited losers require no transaction/)
assert.ok(!uiCopy.includes('Selected deposits leave the parent pool and reappear on the chosen child universe for later settlement.'))
assert.ok(!uiCopy.includes('migratable escalation deposits'))
assert.match(whitepaper, /Each child receives one canonical unresolved-escalation[\s\S]{0,80}snapshot and aggregate backing; winners later settle by proof/)
assert.match(whitepaper, /Child creation reproduces unresolved escalation state[\s\S]{0,100}winning proofs can be relayed[\s\S]{0,40}permissionlessly/)
assert.match(whitepaper, /Escalation Carry/)
assert.match(whitepaper, /snapshot \+ backing once/)
assert.ok(!/eligible[\s\n]+escalation positions move into child pools/.test(whitepaper))
assert.ok(!whitepaper.includes('Migrated winners'))
assert.ok(!/inherited deposits\s+must be settled/.test(whitepaper))
assert.ok(!whitepaper.includes('1:1 child REP to the vault wallet'))
assert.ok(!whitepaper.includes('external-fork migration, and child continuation games'))
assert.ok(!whitepaper.includes('when they do not have unresolved external-fork escalation locks'))
assert.ok(!whitepaper.includes("Local withdrawals adjust the vault's parent-pool ownership"))
assert.ok(!whitepaper.includes('instead convert source REP into child-universe REP'))
assert.ok(!operatorReference.includes('must migrate forked locks'))

assert.match(sharedDocsCss, /body\.doc-openoracle \.diagram-wide > svg\s*{\s*min-width: 60rem;\s*}/)
assert.doesNotMatch(sharedDocsCss, /body\.doc-openoracle svg text\.svg-(?:label|small)\s*{\s*font-size:/)
assert.match(whitepaper, /snapshots preserve the parent balances exactly, including tied maxima\s+below <code>nonDecisionThreshold<\/code>/)
assert.match(operatorReference, /Continuation snapshots preserve the parent balances exactly, including ties/)
assert.ok(!uiCopy.includes('They cannot be split across multiple outcomes.'))

const protocolTerms = await Bun.file('docs/protocolTerms.js').text()
assert.match(protocolTerms, /const repEthPriceDefinition/)
assert.match(protocolTerms, /The REP cost of 1 ETH/)
assert.match(protocolTerms, /A higher value means ETH is more expensive in REP terms/)
assert.match(protocolTerms, /A delayed action that cannot run until the coordinator has a fresh REP\/ETH price\./)
assert.match(protocolTerms, /'bond allowance': 'The amount of REP-backed security-bond exposure a vault currently permits\.'/)
assert.match(protocolTerms, /'security-bond allowance': 'The current amount of REP-backed exposure a vault allows the pool or coordinator to use\.'/)
assert.match(protocolTerms, /splitMigrationRep: splitMigrationRepDefinition/)
assert.match(protocolTerms, /'split migration rep': splitMigrationRepDefinition/)
assert.match(protocolTerms, /It is an eligibility threshold, not an execution-price floor\./)
assert.doesNotMatch(protocolTerms, /floor\(maxRepBeingSold times underfundedWinningEth divided by ethRaiseCap\)/)
assert.match(protocolTerms, /repPerEthPrice: repEthPriceDefinition/)
assert.match(protocolTerms, /'rep\/eth price': repEthPriceDefinition/)
for (const [firstAlias, secondAlias, definitionName] of [
	["'auction time'", 'AUCTION_TIME', 'auctionTimeDefinition'],
	["'dispute delay'", 'disputeDelay', 'disputeDelayDefinition'],
	["'external payoff'", 'externalPayoff', 'externalPayoffDefinition'],
	["'honest price'", 'honestPrice', 'honestPriceDefinition'],
	["'liquidation threshold price'", 'liquidationThresholdPrice', 'liquidationThresholdDefinition'],
	["'migration time'", 'MIGRATION_TIME', 'migrationTimeDefinition'],
	["'price precision'", 'PRICE_PRECISION', 'pricePrecisionDefinition'],
	["'protocol fee recipient'", 'protocolFeeRecipient', 'protocolFeeRecipientDefinition'],
	["'target grief ratio'", 'targetGriefRatio', 'targetGriefRatioDefinition'],
] as const) {
	assert.match(protocolTerms, new RegExp(`${firstAlias}: ${definitionName}`))
	assert.match(protocolTerms, new RegExp(`${secondAlias}: ${definitionName}`))
}
