/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ')

describe('documented protocol constants', () => {
	test('keeps reader-facing docs free of meta reader-instruction phrasing', async () => {
		const docsGlob = new Bun.Glob('docs/**/*.{html,js,md}')
		const paths = ['README.md']
		for await (const path of docsGlob.scan('.')) {
			paths.push(path)
		}
		const discouragedPatterns = [
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
				regex: /\b(the\s+)?core idea is\b/i,
			},
			{
				name: 'wrong question lifecycle actor',
				regex:
					/\b(question|questions)\s+(can|could|may|might|must|will|should)?\s*(becomes?|escalates?|forks?|resolves?|trades?|drives?|causes?|caused)\b|\b(question|questions)\s+(can|could|may|might|must|will|should)?\s*drive\s+[^.]{0,80}\bforks?\b|\b(question|questions)\s+caused\s+[^.]{0,80}\bsplit\b/i,
			},
		]
		const violations: string[] = []
		for (const path of paths.sort()) {
			const text = await Bun.file(path).text()
			const lines = text.split('\n')
			lines.forEach((line, index) => {
				for (const pattern of discouragedPatterns) {
					if (pattern.regex.test(line)) {
						violations.push(`${path}:${index + 1}: ${pattern.name}: ${line.trim()}`)
					}
				}
			})
			const normalizedText = normalizeWhitespace(text)
			for (const pattern of discouragedPatterns) {
				if (pattern.regex.test(normalizedText)) {
					violations.push(`${path}: normalized: ${pattern.name}`)
				}
			}
		}

		expect(violations).toEqual([])
	})

	test('detects discouraged docs wording across wrapped whitespace', () => {
		const wrappedText = normalizeWhitespace('This\npage explains the lifecycle.')
		const metaPageFraming = /\b(?:in\s+)?(this|these)\s+(page|guide|reference|document|whitepaper|docs|table),?\s+(explains|describes|maps|lists|keeps|is|summarizes|usually)\b/i
		const theseDocsFraming = /\b(?:in\s+)?these\s+docs\b/i

		expect(metaPageFraming.test(wrappedText)).toBe(true)
		expect(theseDocsFraming.test(normalizeWhitespace('These\ndocs describe the lifecycle.'))).toBe(true)
		expect(theseDocsFraming.test(normalizeWhitespace('In\nthese docs, allowance means exposure.'))).toBe(true)
	})

	test('detects discouraged plural document-subject wording', () => {
		const pluralMetaFraming = /\b(?:in\s+)?(this|these)\s+(page|pages|guide|guides|reference|references|document|documents|whitepaper|whitepapers|docs|table|tables),?\s+(explains|explain|describes|describe|maps|map|lists|list|keeps|keep|is|are|summarizes|summarize|usually)\b/i
		const pluralDocumentSubjectFraming =
			/\b(white paper|white papers|whitepaper|whitepapers|reference|references|auction design|auction designs|guide|guides|document|documents|docs|page|pages|section|sections|sidebar|sidebars|table|tables)\s+(explains|explain|keeps|keep|summarizes|summarize|maps|map|describes|describe|lists|list|expands|expand|collects|collect|defines|define|is|are)\b/i

		expect(pluralMetaFraming.test('These documents explain the lifecycle.')).toBe(true)
		expect(pluralDocumentSubjectFraming.test('References summarize the guardrails.')).toBe(true)
	})

	test('detects question-as-lifecycle-actor wording with modal verbs', () => {
		const wrongQuestionLifecycleActor =
			/\b(question|questions)\s+(can|could|may|might|must|will|should)?\s*(becomes?|escalates?|forks?|resolves?|trades?|drives?|causes?|caused)\b|\b(question|questions)\s+(can|could|may|might|must|will|should)?\s*drive\s+[^.]{0,80}\bforks?\b|\b(question|questions)\s+caused\s+[^.]{0,80}\bsplit\b/i

		expect(wrongQuestionLifecycleActor.test('the question can become a pool')).toBe(true)
		expect(wrongQuestionLifecycleActor.test('An ended global question can fork an unforked universe')).toBe(true)
		expect(wrongQuestionLifecycleActor.test('question can drive universe forks')).toBe(true)
		expect(wrongQuestionLifecycleActor.test('question drives a fork')).toBe(true)
		expect(wrongQuestionLifecycleActor.test('question caused the universe to split')).toBe(true)
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
		expect(startHere).toContain('Core terms come first')
		expect(startHere).toContain('A <em>universe</em> is a Zoltar truth branch')
		expect(startHere).toContain('<code>Zoltar</code> owns forkable truth universes and child REP')
		expect(startHere).toContain('Placeholder owns market mechanics on top of those universes')
		expect(startHere.indexOf('Core terms come first')).toBeLessThan(startHere.indexOf('<code>Zoltar</code> owns forkable truth universes'))
		expect(startHere).not.toContain('The core idea is split responsibility')
		expect(startHere).not.toContain('A question becomes a pool')
		expect(startHere).not.toContain('escalates if needed')
		expect(startHere).not.toContain('This guide is')
		expect(startHere).not.toContain('Read it before')
		expect(startHere.indexOf('<em>migration balance</em>')).toBeLessThan(startHere.indexOf('<em>child REP</em> is REP minted'))
		expect(startHere).toContain('reproduced into selected fork branches')
		expect(startHere).toMatch(/each branch receiving at\s+most that source balance/)
		expect(startHere).toMatch(/Reproduce parent-universe migration balance[\s\S]*each\s+child capped by the source balance/)
		expect(startHere).toMatch(/the\s+amount of REP-backed exposure they permit/)
		expect(startHere).toMatch(/the REP value\s+available after a fork/)
		expect(startHere).toContain('fig-start-here-lifecycle')
		expect(startHere).toContain('eq-start-here-complete-set')
		expect(startHere).toContain('Why it exists')
		expect(auctionDesign).toContain('Uniform Price Dual Cap Batch Auction')
		expect(auctionDesign).toContain('Why This Auction Exists')
		expect(auctionDesign).toContain('A collateral-repair auction belongs to the fork recovery path')
		expect(auctionDesign).not.toContain('This page explains')
		expect(auctionDesign).not.toContain('Read this as')
		expect(auctionDesign).toMatch(/A\s+<em>fork<\/em> is\s+the split/)
		expect(auctionDesign).toMatch(/A\s+<em>child pool<\/em> is\s+the market pool in one fork\s+branch/)
		expect(auctionDesign).toMatch(/A\s+<em>truth auction<\/em> is a sale that repairs a child pool\s+after a fork/)
		expect(auctionDesign.search(/A\s+<em>fork<\/em>/)).toBeLessThan(auctionDesign.search(/A\s+<em>fork branch<\/em>/))
		expect(auctionDesign.search(/A\s+<em>child pool<\/em>/)).toBeLessThan(auctionDesign.search(/A\s+<em>truth auction<\/em>/))
		expect(auctionDesign.search(/A\s+<em>truth auction<\/em>/)).toBeLessThan(auctionDesign.indexOf('<code>SecurityPoolForker</code> uses this auction'))
		expect(auctionDesign).toMatch(/<em>child-universe REP<\/em> is REP minted inside that\s+branch/)
		expect(auctionDesign).toContain('same-tick bids fill FIFO by submission order')
		expect(auctionDesign).toContain('Try a simple auction clearing run')
		expect(auctionDesign).toContain('fig-auction-lifecycle')
		expect(auctionDesign).toContain('eq-auction-rep-won')
		expect(auctionDesign).toContain('underfundedWinningEth')
		expect(auctionDesign).toContain('minBidSize = max(ethRaiseCap / 100000, 1 wei)')
		expect(auctionDesign).toContain('const activeBids = bids.filter((bid) => bid.eth > 0)')
		expect(openOracleIntegration).toContain('The operating path comes before the security model')
		expect(openOracleIntegration).toContain('The estimator stresses the formula inputs')
		expect(openOracleIntegration).not.toContain('read this page')
		expect(openOracleIntegration).not.toContain('Use this estimator')
		expect(openOracleIntegration).not.toContain('Use the inputs')
		expect(openOracleIntegration).toMatch(/current REP\/ETH price is\s+strictly above that threshold and at least the configured\s+<span class="term" tabindex="0">liquidation distance<\/span> beyond it/)
		expect(openOracleIntegration).toMatch(/manipulated REP\/ETH price is strictly above\s+the liquidation threshold and satisfies the configured liquidation\s+distance check/)
		expect(openOracleIntegration).not.toContain('crosses the liquidation threshold')
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
		expect(placeholder).toContain('Unresolved Escalation Migration Trace')
		expect(placeholder).toContain('initializeForkCarrySnapshotWithResolutionBalances')
		expect(placeholder).toContain('Fork Migration Contract Trace')
		expect(placeholder).toContain('Oracle-Staged Operation Trace')
		expect(placeholder).toContain('./auction-design.html')
		expect(operatorReference).toContain('Implementation guardrails map to their contract sources')
		expect(operatorReference).not.toContain('This reference maps')
		expect(operatorReference).not.toContain('this page keeps')
		expect(zoltar).toContain('Entry overview')
		expect(zoltar).not.toContain('First read')
		expect(await Bun.file('docs/auction-design.md').exists()).toBe(false)
	})
})
