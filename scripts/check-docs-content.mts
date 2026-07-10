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

const textReviewGuidance = await Bun.file('.codex/agents/textReview.toml').text()
assert.match(textReviewGuidance, /"these docs"/)
assert.match(textReviewGuidance, /"reference summarizes\.\.\."/)
assert.match(textReviewGuidance, /"auction design explains\.\.\."/)
assert.match(textReviewGuidance, /Document\s+titles should not be\s+grammatical subjects/)

const whitepaper = await Bun.file('docs/whitepaper_placeholder.html').text()
const openOracleIntegration = await Bun.file('docs/openOracleIntegration.html').text()
const operatorReference = await Bun.file('docs/operator-reference.md').text()
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
assert.match(whitepaper, /The continuation preserves the parent live\s+<code>Invalid<\/code>,\s+<code>Yes<\/code>,\s+and\s+<code>No<\/code>\s+balances[\s\S]{0,220}Forked escrow then\s+tracks how much child REP backing has arrived for those inherited\s+unresolved deposits without rebasing the preserved live balances\./)
assert.match(operatorReference, /\| Continuation balance snapshot \| Child continuations initialize live `Invalid`\/`Yes`\/`No` balances from the parent escalation game, while forked escrow separately tracks source principal and arriving child REP backing for inherited unresolved deposits\./)
assert.match(whitepaper, /preserved positive tied maxima below\s+<code>nonDecisionThreshold<\/code>/)
assert.match(operatorReference, /preserved positive tied maxima below `nonDecisionThreshold`/)

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
