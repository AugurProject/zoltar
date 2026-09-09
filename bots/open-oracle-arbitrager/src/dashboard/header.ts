import { renderOperatorHeader } from '../../../shared/src/dashboard/header.ts'

export const operatorHeader = renderOperatorHeader({
	title: 'OpenOracle Arbitrager',
	eyebrow: 'Zoltar operator console',
	blockStatus: 'Block — · waiting for first observation',
	safety: `<span id="mode-badge" class="badge">Mode —</span>
					<span id="run-status-badge" class="badge">Run —</span>
					<span id="capability-badge" class="badge">Capability —</span>
					<span id="retry-status-badge" class="badge badge-warning" hidden>Retry —</span>
					<span id="header-network-badge" class="badge">Network —</span>
					<a id="attention-badge" class="badge attention-badge">No blockers</a>
					<button id="refresh-button" class="button button-secondary" type="button">Refresh</button>
					<button id="pause-button" class="button" type="button" disabled>Pause bot</button>`,
	navigation: `<a href="/overview">Overview</a>
				<a href="/operations">Opportunities</a>
				<a href="/games">Games</a>
				<a href="/markets">Markets</a>
				<a href="/settings">Settings</a>
				<a href="/documentation">Operator guide</a>`,
})
