/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'

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

const tableRowContaining = (html: string, text: string) => {
	const textIndex = html.indexOf(text)
	if (textIndex === -1) {
		throw new Error(`Could not find table row containing ${text}`)
	}
	const rowStart = html.lastIndexOf('<tr>', textIndex)
	const rowEnd = html.indexOf('</tr>', textIndex)
	if (rowStart === -1 || rowEnd === -1) {
		throw new Error(`Could not find table row boundaries containing ${text}`)
	}
	return html.slice(rowStart, rowEnd + '</tr>'.length)
}

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

const violationNames = (violations: string[]) =>
	violations.map(violation => {
		const match = violation.match(/: ([^:]+):/)
		return match?.[1] ?? violation
	})

const hasViolation = (violations: string[], name: string) => violationNames(violations).includes(name) || violations.some(violation => violation.includes(`: ${name}`))

describe('documented protocol constants', () => {
	test('keeps reader-facing docs free of meta reader-instruction phrasing', async () => {
		const docsGlob = new Bun.Glob('docs/**/*.{html,js,md}')
		const paths = ['README.md']
		for await (const path of docsGlob.scan('.')) {
			paths.push(path)
		}
		const violations: string[] = []
		for (const path of paths.sort()) {
			const text = await Bun.file(path).text()
			violations.push(...findDiscouragedDocsWording(path, text))
			violations.push(...findDefinitionPileups(path, text))
		}

		expect(violations).toEqual([])
	})

	test('detects discouraged docs wording across wrapped whitespace', () => {
		const cases = [
			{
				text: 'This\npage explains the lifecycle.',
				name: 'meta page framing',
			},
			{
				text: 'These\ndocs describe the lifecycle.',
				name: 'these-docs framing',
			},
			{
				text: 'In\nthese docs, allowance means exposure.',
				name: 'these-docs framing',
			},
		]

		for (const testCase of cases) {
			expect(hasViolation(findDiscouragedDocsWording('docs/example.md', testCase.text), testCase.name)).toBe(true)
		}
	})

	test('detects discouraged plural document-subject wording', () => {
		const cases = [
			{
				text: 'These documents explain the lifecycle.',
				name: 'meta page framing',
			},
			{
				text: 'References summarize the guardrails.',
				name: 'document-subject framing',
			},
		]

		for (const testCase of cases) {
			expect(hasViolation(findDiscouragedDocsWording('docs/example.md', testCase.text), testCase.name)).toBe(true)
		}
	})

	test('detects question-as-lifecycle-actor wording with modal verbs', () => {
		const cases = [
			'the question can become a pool',
			'An ended global question can fork an unforked universe',
			'question can drive universe forks',
			'question drives a fork',
			'question caused the universe to split',
			'the question that triggered the fork',
			'the question whose unresolved outcome caused parentUniverse to split',
			'forkQuestion triggered a fork',
			'question can be resolved',
			'question is forked',
			'question gets traded',
			'the question cannot settle locally',
			'questions can settle after escalation',
			'question is already resolved',
			'question can later be resolved',
			'question cannot safely settle',
			'the question that becomes a pool',
			'the question which settles locally',
			'question eventually escalates',
			'question can quickly be resolved',
		]

		for (const text of cases) {
			expect(hasViolation(findDiscouragedDocsWording('docs/example.md', text), 'wrong question lifecycle actor')).toBe(true)
		}
	})

	test('detects contract-inaccurate fork migration shortcuts', () => {
		expect(hasViolation(findDiscouragedDocsWording('docs/example.md', 'Placeholder creates one child pool for each fork branch.'), 'exhaustive child-pool creation')).toBe(true)
		expect(hasViolation(findDiscouragedDocsWording('docs/example.html', '<p>After a fork, a holder receives a <em>migration balance</em>.</p>'), 'passive migration-balance grant')).toBe(true)
	})

	test('detects discouraged docs wording split by inline HTML tags', () => {
		const html = ['<p><code>forkQuestion</code> triggered a fork.</p>', '<p>the <code>question</code> can become a pool.</p>', '<p>question <em>can</em> settle locally.</p>'].join('\n')

		expect(findDiscouragedDocsWording('docs/example.html', html)).toEqual([
			'docs/example.html:visible:1: wrong question lifecycle actor: forkQuestion  triggered a fork.',
			'docs/example.html:visible:2: wrong question lifecycle actor: the  question  can become a pool.',
			'docs/example.html:visible:3: wrong question lifecycle actor: question  can  settle locally.',
			'docs/example.html: visible normalized: wrong question lifecycle actor',
		])
	})

	test('detects definition pileups before lifecycle action', () => {
		const html = `
			<p>
				A <em>fork</em> is a split. A <em>fork branch</em> is one path.
				A <em>child pool</em> is a pool in that branch. A
				<em>truth auction</em> is a repair sale after a fork; it does not
				choose truth.
			</p>
		`
		const htmlWithManyTerms = `
			<p>
				Core terms come first. A <em>universe</em> is a truth branch. A
				<em>migration balance</em> means forked REP value. A
				<em>security vault</em> is a pool account, while
				<em>local escalation</em>, <em>fork migration</em>, and a
				<em>truth auction</em> complete the path.
			</p>
		`
		const markdown = `
			A *fork* is a split. A *fork branch* is one path. A *child pool*
			is a pool in that branch. A *truth auction* is a repair sale after
			a fork; it does not choose truth.
		`

		expect(findDefinitionPileups('docs/example.html', html)).toEqual(['docs/example.html:paragraph 1: definition pileup: A fork is a split. A fork branch is one path. A child pool is a pool in that branch. A truth auction is a repair sale after a fork; it does not choose truth.'])
		expect(findDefinitionPileups('docs/example.html', htmlWithManyTerms)[0]).toStartWith('docs/example.html:paragraph 1: definition pileup: Core terms come first.')
		expect(findDefinitionPileups('docs/example.md', markdown)[0]).toStartWith('docs/example.md:paragraph 1: definition pileup: A *fork* is a split. A *fork branch* is one path.')
	})

	test('keeps text-review guidance explicit about meta-document phrasing variants', async () => {
		const textReviewGuidance = await Bun.file('.codex/agents/textReview.toml').text()

		expect(textReviewGuidance).toContain('"these docs"')
		expect(textReviewGuidance).toContain('"reference summarizes..."')
		expect(textReviewGuidance).toContain('"auction design explains..."')
		expect(textReviewGuidance).toContain('"document lists..."')
		expect(textReviewGuidance).toContain('"next ask..."')
		expect(textReviewGuidance).toContain('"sidebar is..."')
		expect(textReviewGuidance).toContain('"Start with these words..."')
		expect(textReviewGuidance).toMatch(/Document\s+titles should not be\s+grammatical subjects/)
	})

	test('keeps Placeholder OpenOracle timing constants aligned with the implementation', async () => {
		const whitepaper = await Bun.file('docs/whitepaper_placeholder.html').text()
		const openOracleIntegration = await Bun.file('docs/openOracleIntegration.html').text()

		expect(whitepaper).toContain('PRICE_VALID_FOR_SECONDS = 5 minutes')
		expect(whitepaper).toMatch(/<td><code>PRICE_VALID_FOR_SECONDS<\/code><\/td>\s*<td><code>5 minutes<\/code><\/td>/)
		expect(whitepaper).toMatch(/OpenOracle <code>settlementTime<\/code><\/td>\s*<td>\s*<math aria-label="40 times 12" data-source="40 \\cdot 12"/)
		expect(whitepaper).toContain('<code>480 seconds (8 minutes)</code>')
		expect(whitepaper).toMatch(/the configured OpenOracle <code>timeType<\/code> uses\s+seconds/)
		expect(openOracleIntegration).toContain('<code>480 seconds (8 minutes)</code>')
		expect(openOracleIntegration).toMatch(/the configured OpenOracle <code>timeType<\/code> uses seconds/)
		expect(whitepaper).not.toContain('PRICE_VALID_FOR_SECONDS = 1 hour')
		expect(whitepaper).not.toContain('Settlement delay encoded as <code>15 \\cdot 12</code>.')
	})

	test('keeps Placeholder REP-denominated docs constants explicit', async () => {
		const whitepaper = await Bun.file('docs/whitepaper_placeholder.html').text()

		expect(whitepaper).toContain('<code>1 REP</code> default deployment value')
		expect(whitepaper).toMatch(/<td><code>initialEscalationGameDeposit<\/code><\/td>\s*<td><code>1 REP<\/code> default<\/td>/)
		expect(whitepaper).toContain('<code>1000000000000000000</code> atomic REP units')
		expect(whitepaper).not.toMatch(/initialEscalationGameDeposit[\s\S]{0,200}<code>1 ether<\/code>/)
	})

	test('keeps REP/ETH tooltip aliases aligned on price direction', async () => {
		const protocolTerms = await Bun.file('docs/protocolTerms.js').text()

		expect(protocolTerms).toContain('const repEthPriceDefinition')
		expect(protocolTerms).toContain('The REP cost of 1 ETH')
		expect(protocolTerms).toContain('A higher value means ETH is more expensive in REP terms')
		expect(protocolTerms).toContain('A delayed action that cannot run until the coordinator has a fresh REP/ETH price.')
		expect(protocolTerms).toContain('A Zoltar truth branch. Each universe has its own REP token and may have a parent universe.')
		expect(protocolTerms).toContain('A timed sale with fixed rules.')
		expect(protocolTerms).toContain('A REP-backed underwriting pool for one question in one universe.')
		expect(protocolTerms).toContain("'bond allowance': 'The amount of REP-backed security-bond exposure a vault currently permits.'")
		expect(protocolTerms).toContain("'security-bond allowance': 'The current amount of REP-backed exposure a vault allows the pool or coordinator to use.'")
		expect(protocolTerms).toContain("forkThresholdDivisor: 'The Zoltar constructor immutable that computes the fork threshold from theoretical REP supply.'")
		expect(protocolTerms).toContain("forkBurnDivisor: 'The Zoltar constructor immutable that determines the uncredited haircut between the full parent-REP fork burn and the initiator migration balance.'")
		expect(protocolTerms).not.toContain('FORK_THRESHOLD_DIVISOR')
		expect(protocolTerms).not.toContain('FORK_BURN_DIVISOR')
		expect(protocolTerms).toContain('A holder can reproduce it into selected child universes; each child can receive up to the source balance.')
		expect(protocolTerms).toContain('when holders can reproduce migration balance into selected child REP')
		expect(protocolTerms).toMatch(/splitMigrationRep: 'The Zoltar function that mints a chosen amount of child REP in each selected child universe, capped per child by the caller migration balance\. This is reproduction, not pro-rata splitting\.'/)
		expect(protocolTerms).toContain("'split migration rep': 'The action that mints a chosen amount of child REP in each selected child universe, capped per child by the caller migration balance. This is reproduction, not pro-rata splitting.'")
		expect(protocolTerms).toContain('The REP/ETH price above which a vault can become liquidatable, after the configured distance check.')
		expect(protocolTerms).toContain('The REP/ETH price above which the modeled liquidation path can become executable, after the configured distance check.')
		expect(protocolTerms).toContain("'binary censorship bound': 'A simple attack-cost check for yes/no liquidation payoffs. The attacker only gains if the bad report is strictly above the liquidation threshold and satisfies the configured distance check.'")
		expect(protocolTerms).toContain("'binary dynamic programming terminal': 'The final payoff rule in the simplified delay model. The attacker is paid only if the manipulated price is strictly above the liquidation threshold and satisfies the configured distance check.'")
		expect(protocolTerms).toContain("'staged liquidation': 'A delayed liquidation that runs only if a fresh price is strictly above the liquidation threshold and satisfies the configured distance check.'")
		expect(protocolTerms).toMatch(/repPerEthPrice: repEthPriceDefinition/)
		expect(protocolTerms).toMatch(/'rep\/eth price': repEthPriceDefinition/)
	})

	test('keeps educational entry points and auction design in HTML docs', async () => {
		const readme = await Bun.file('README.md').text()
		const startHere = await Bun.file('docs/start-here.html').text()
		const auctionDesign = await Bun.file('docs/auction-design.html').text()
		const openOracleIntegration = await Bun.file('docs/openOracleIntegration.html').text()
		const operatorReference = await Bun.file('docs/operator-reference.md').text()
		const placeholder = await Bun.file('docs/whitepaper_placeholder.html').text()
		const zoltar = await Bun.file('docs/whitepaper_zoltar.html').text()

		expect(readme).toContain('./docs/start-here.html')
		expect(readme).toContain('./docs/auction-design.html')
		expect(startHere).toContain('Placeholder and Zoltar Start Here')
		expect(startHere).toContain('One Example Market End to End')
		expect(startHere).toContain('Concept Glossary by Lifecycle Stage')
		expect(startHere).toContain('Documentation Map')
		expect(startHere).toContain('id="documentation-map"')
		expect(startHere).toContain('Role in the flow')
		expect(startHere).toContain('Primary contracts')
		expect(startHere).not.toContain('Read Next')
		expect(startHere).not.toContain('id="read-next"')
		expect(startHere).not.toContain('Reader shortcut')
		expect(startHere).not.toContain('Contracts to read')
		expect(startHere).toContain('Two ideas anchor the lifecycle')
		expect(startHere).toContain('Zoltar universes are truth branches')
		expect(startHere).toContain('After a fork, a holder can have <em>migration balance</em>')
		expect(startHere).toContain('initiating the fork or adding parent REP after the fork')
		expect(startHere).not.toContain('After a fork, a holder receives a <em>migration balance</em>')
		expect(startHere).toContain('<code>Zoltar</code> owns forkable truth universes and child REP')
		expect(startHere).toContain('Placeholder owns market mechanics on top of those universes')
		expect(startHere.indexOf('Two ideas anchor the lifecycle')).toBeLessThan(startHere.indexOf('<code>Zoltar</code> owns forkable truth universes'))
		expect(startHere).not.toContain('The core idea is split responsibility')
		expect(startHere).not.toContain('A question becomes a pool')
		expect(startHere).not.toContain('escalates if needed')
		expect(startHere).not.toContain('This guide is')
		expect(startHere).not.toContain('Read it before')
		const childRepMint = startHere.search(/Reproduction mints\s+<em>child REP<\/em>/)
		expect(startHere.indexOf('<em>migration balance</em>')).toBeLessThan(childRepMint)
		expect(startHere).toMatch(/reproduced into selected fork\s+branches/)
		expect(startHere).toMatch(/each branch\s+receiving at\s+most the source balance/)
		expect(startHere).toMatch(/Reproduce parent-universe migration balance[\s\S]*each\s+child capped by the source balance/)
		expect(startHere).toMatch(/the\s+amount of REP-backed exposure they permit/)
		expect(startHere).toMatch(/the REP value\s+available after a fork/)
		expect(startHere).toContain('fig-start-here-lifecycle')
		expect(startHere).toContain('eq-start-here-complete-set')
		expect(startHere).toContain('Why it exists')
		expect(auctionDesign).toContain('Uniform Price Dual Cap Batch Auction')
		expect(auctionDesign).toContain('Why This Auction Exists')
		expect(auctionDesign).toContain('Auction repair happens after fork migration')
		expect(auctionDesign).toContain('callers can create')
		expect(auctionDesign).toContain('<em>child pools</em> for selected valid fork branches')
		expect(auctionDesign).toContain('Each child pool uses REP from its child universe')
		expect(auctionDesign).not.toContain('Placeholder creates one')
		expect(auctionDesign).not.toContain('for each fork branch')
		expect(auctionDesign).not.toContain('This page explains')
		expect(auctionDesign).not.toContain('Read this as')
		expect(auctionDesign).not.toContain('A <em>fork</em> is')
		expect(auctionDesign).not.toContain('A <em>truth auction</em> is a sale')
		expect(auctionDesign.indexOf('Auction repair happens after fork migration')).toBeLessThan(auctionDesign.indexOf('Each child pool uses REP from its child universe'))
		expect(auctionDesign.indexOf('Each child pool uses REP from its child universe')).toBeLessThan(auctionDesign.indexOf('<code>SecurityPoolForker</code> uses this auction'))
		expect(auctionDesign).not.toContain('<em>child-universe REP</em> is REP minted')
		expect(auctionDesign).toContain('same-tick bids fill FIFO by submission order')
		expect(auctionDesign).toContain('Try a simple auction clearing run')
		expect(auctionDesign).toContain('fig-auction-lifecycle')
		expect(auctionDesign).toContain('eq-auction-rep-won')
		expect(auctionDesign).toContain('underfundedWinningEth')
		expect(auctionDesign).toContain('minBidSize = max(ethRaiseCap / 100000, 1 wei)')
		expect(auctionDesign).toContain('const activeBids = bids.filter((bid) => bid.eth > 0)')
		expect(openOracleIntegration).toMatch(/A stale or missing price sends solvency-sensitive operations into\s+staging/)
		expect(openOracleIntegration).not.toContain('The operating path comes before the security model')
		expect(openOracleIntegration).toContain('The OpenOracle report instance uses REP as <code>token1</code>')
		expect(openOracleIntegration).not.toContain('OpenOracle reports the onchain REP/WETH pair')
		expect(openOracleIntegration).toContain('The estimator stresses the formula inputs')
		expect(openOracleIntegration).not.toContain('read this page')
		expect(openOracleIntegration).not.toContain('Use this estimator')
		expect(openOracleIntegration).not.toContain('Use the inputs')
		expect(openOracleIntegration).toMatch(/current REP\/ETH price is\s+strictly above that threshold and at least the configured\s+<span class="term" tabindex="0">liquidation distance<\/span> beyond it/)
		expect(openOracleIntegration).toMatch(/manipulated REP\/ETH price is strictly above\s+the liquidation threshold and satisfies the configured liquidation\s+distance check/)
		expect(openOracleIntegration).toContain('Contract Liquidation Guard')
		expect(openOracleIntegration).toContain('thresholdPrice = floor(vaultRep * PRICE_PRECISION / (snapshotTargetAllowance * securityMultiplier))')
		expect(openOracleIntegration).toContain('currentPrice > thresholdPrice')
		expect(openOracleIntegration).toContain('pendingOperationSlotId')
		expect(openOracleIntegration).toMatch(/other staged\s+operations active/)
		expect(openOracleIntegration).not.toContain('crosses the liquidation threshold')
		expect(openOracleIntegration).not.toContain('strictly beyond the liquidation threshold')
		expect(placeholder).toContain('Why not fork immediately?')
		expect(placeholder).toContain('The lifecycle has four checkpoints')
		expect(placeholder).toContain('Why it matters')
		expect(placeholder).toContain('Entry overview')
		expect(placeholder).not.toContain('Read the lifecycle')
		expect(placeholder).not.toContain('Use the inputs')
		expect(placeholder).not.toContain('Why readers should care')
		expect(placeholder).not.toContain('First read')
		expect(placeholder).toMatch(/fresh current REP\/ETH price is strictly above\s+the computed threshold and far enough beyond it to satisfy the\s+configured <code>minLiquidationPriceDistanceBps<\/code> liquidation\s+distance check/)
		expect(placeholder).toContain('Escalation Deposit Trace')
		expect(placeholder).toContain('Escalation cost curve')
		expect(placeholder).toContain('fixed-point integer approximation using <code>SCALE = 1e6</code>')
		expect(placeholder).toContain('floor(bindingCapital / excessRewardWindowDivisor)')
		expect(placeholder).toContain('every Solidity division floors before the next step')
		expect(placeholder).toContain('utilizationScaled')
		expect(placeholder).toContain('floor(completeSetCollateralAmount * PRICE_PRECISION / totalSecurityBondAllowance)')
		expect(placeholder).toContain('utilizationRatio = floor(utilizationScaled * PRICE_PRECISION / RETENTION_RATE_DIP)')
		expect(placeholder).toContain('floor((MAX_RETENTION_RATE - MIN_RETENTION_RATE) * utilizationRatio / PRICE_PRECISION)')
		expect(placeholder).toContain('underfundedThreshold = floor(acceptedBidEthForThreshold')
		expect(placeholder).not.toContain('underfundedThreshold = acceptedBidEthForThreshold \\cdot PRICE_PRECISION / maxRepBeingSold')
		expect(placeholder).toContain('tickToPrice(tick)')
		expect(placeholder).toContain('tickRepDemand = floor(tickTotalEth')
		expect(placeholder).toContain('underfundedRepShare = floor(bidEth')
		expect(placeholder).toMatch(/Underfunded\s+ticks qualify at or above the floored threshold\./)
		expect(placeholder).toContain('thresholdPrice = floor(vaultRep')
		expect(placeholder).toContain('currentPrice &gt; thresholdPrice')
		expect(placeholder).toContain('distanceBps = floor((currentPrice - thresholdPrice)')
		const liquidationDistanceRow = tableRowContaining(placeholder, '<td><code>minLiquidationPriceDistanceBps</code></td>')
		expect(liquidationDistanceRow).toContain('strictly above the floored threshold price')
		expect(liquidationDistanceRow).toContain('distanceBps')
		expect(liquidationDistanceRow).toContain('floor')
		expect(liquidationDistanceRow).toContain('distanceBps &gt;= minLiquidationPriceDistanceBps')
		const oracleParameterRows = [
			'<td><code>gasConsumedSettlement</code></td>',
			'<td><code>MAX_PENDING_SETTLEMENT_OPERATIONS</code></td>',
			'<td><code>MAX_OPERATION_VALID_FOR_SECONDS</code></td>',
			'<td>OpenOracle <code>exactToken1Report</code></td>',
			'<td>OpenOracle <code>escalationHalt</code></td>',
			'<td>OpenOracle <code>settlerReward</code></td>',
		]
		for (const parameter of oracleParameterRows) {
			expect(tableRowContaining(placeholder, parameter)).toMatch(/constant|Deployment-configured|Derived|Dynamic|immutable/i)
		}
		expect(placeholder).toContain('0.1000 ETH/REP')
		expect(placeholder).toContain('2.0000 REP')
		expect(placeholder).toContain('0.8000 REP')
		expect(placeholder).toContain('98.0000 REP')
		expect(placeholder).toContain('Meaning and source / mutability')
		expect(placeholder).toContain('Unresolved Escalation Migration Trace')
		expect(placeholder).toContain('initializeForkCarrySnapshotWithResolutionBalances')
		expect(placeholder).toContain('Fork Migration Contract Trace')
		expect(placeholder).toContain('Oracle-Staged Operation Trace')
		expect(placeholder).toContain('Recover settled report')
		expect(placeholder).toContain('pendingOperationSlotId')
		expect(placeholder).toContain('./auction-design.html')
		expect(operatorReference).toContain('Implementation guardrails map to their contract sources')
		expect(operatorReference).not.toContain('This reference maps')
		expect(operatorReference).not.toContain('this page keeps')
		expect(zoltar).toContain('Entry overview')
		expect(zoltar).toContain('<code>Invalid</code> is a valid answer branch')
		expect(zoltar).toContain('<code>Malformed</code> means an encoded answer option is rejected')
		expect(zoltar).toContain('any caller with threshold REP can call <code>forkUniverse</code>')
		expect(zoltar).toContain('forkThresholdDivisor')
		expect(zoltar).toContain('forkBurnDivisor')
		expect(zoltar).toContain('displayedAtomic')
		expect(zoltar).toContain('floor(secondPayoutNumerator * (displayValueMax - displayValueMin) / numTicks)')
		expect(zoltar).toContain('Question Types Supported by Zoltar')
		expect(zoltar).toContain('href="#question-types"')
		expect(zoltar).toContain('id="question-types"')
		expect(zoltar).not.toContain('href="#market-types"')
		expect(zoltar).not.toContain('id="market-types"')
		expect(zoltar).not.toContain('Market Types Supported by Zoltar')
		expect(zoltar).not.toContain('FORK_THRESHOLD_DIVISOR')
		expect(zoltar).not.toContain('FORK_BURN_DIVISOR')
		expect(zoltar).not.toContain('First read')
		expect(startHere).toContain('Traders mint ETH-backed shares')
		expect(startHere).toContain('strict leading outcome')
		expect(startHere).toContain('If every outcome has no deposits')
		expect(startHere).toContain('Callers create child pools and split pool REP')
		expect(startHere).toContain('cashToShares')
		expect(startHere).toContain('sharesToCash')
		expect(startHere).not.toContain('= 1 ETH claim')
		expect(auctionDesign).toContain('External forker call')
		expect(auctionDesign).toContain('Auction call it invokes')
		expect(auctionDesign).toContain('startTruthAuction')
		expect(auctionDesign).toContain('finalizeTruthAuction')
		expect(auctionDesign).toContain('claimAuctionProceeds')
		expect(auctionDesign).toContain('refundLosingBidsFor')
		expect(auctionDesign).toContain('underfundedThreshold = floor(ethRaised * PRICE_PRECISION / maxRepBeingSold)')
		expect(auctionDesign).toContain('PRICE_PRECISION = 1e18')
		expect(auctionDesign).toContain('equality wins')
		expect(auctionDesign).toMatch(/uses real-number arithmetic for\s+readability/)
		expect(await Bun.file('docs/auction-design.md').exists()).toBe(false)
	})
})
