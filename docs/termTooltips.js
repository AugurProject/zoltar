const termDefinitions = {
	callback: 'A contract call OpenOracle makes during settlement so another contract can consume the settled report amounts.',
	bounty: 'The ETH the coordinator forwards to OpenOracle so a settler has a settlement incentive.',
	'child rep': 'Reputation minted inside a child universe from migration balance.',
	'colored coins model': 'A branch-aware claim model for coordinating assets after a fork.',
	'complete set': 'One Invalid, one Yes, and one No share minted together against ETH collateral.',
	'escalation game': 'The local dispute process that tries to resolve a market before a fork.',
	'escalation halt': 'The maximum report size after which OpenOracle disputes stop multiplying and advance linearly.',
	'eth-notional': 'Operation exposure expressed as ETH value so different operation types can share one budget.',
	'fresh price': 'A cached oracle price that has not passed the coordinator validity window.',
	invalid: 'A valid answer state for an unresolvable or invalid market outcome.',
	'liquidation distance': 'The required margin beyond the liquidation threshold before a staged liquidation may execute.',
	'liquidation threshold': 'The REP/ETH price at which a vault becomes undercollateralized enough to liquidate.',
	malformed: 'An answer encoding rejected by the question definition.',
	'migrated rep': 'REP backing carried into a child universe to support a child pool.',
	migration: 'Moving pool state from a parent universe into child universes after a fork.',
	'migration balance': 'REP value held after a fork that can be split into one or more child universes.',
	'non-decision': 'The unresolved escalation state that opens the Zoltar fork path.',
	pool: 'A SecurityPool for one question in one universe.',
	'price round': 'One settled REP/ETH price plus the operation volume it is allowed to authorize.',
	'price-round budget': 'The remaining ETH-denominated operation volume one settled oracle price may authorize.',
	'report liquidity': 'The economic size of the OpenOracle report that honest reporters can use to dispute a manipulated price.',
	'request bounty': 'The ETH the coordinator forwards to OpenOracle so a settler has a settlement incentive.',
	'soft rejection': 'A callback failure that settles the OpenOracle report but does not update the coordinator price or replay queued operations.',
	'staged operation': 'A queued liquidation, withdrawal, or allowance update waiting for a fresh oracle price.',
	'truth auction': 'A child-pool auction that sells child-universe REP for ETH to repair missing collateral.',
	universe: 'A Zoltar fork domain with its own REP token and optional parent universe.',
	vault: 'A pool-specific REP account whose owner supplies underwriting capacity.',
}

function normalizeTermKey(value) {
	return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function applyTermTooltips() {
	for (const element of document.querySelectorAll('.term')) {
		const rawKey = element.getAttribute('data-term') ?? element.textContent ?? ''
		const definition = termDefinitions[normalizeTermKey(rawKey)]
		if (definition === undefined) continue
		element.setAttribute('title', definition)
		if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '0')
	}
}

applyTermTooltips()
