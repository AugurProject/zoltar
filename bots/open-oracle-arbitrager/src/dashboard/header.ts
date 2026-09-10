import { renderOperatorHeader } from '../../../shared/src/dashboard/header.ts'

export const operatorHeader = renderOperatorHeader({
	title: 'OpenOracle Arbitrager',
	eyebrow: 'Zoltar operator console',
	blockStatus: 'Block — · waiting for first observation',
	safety: `<span id="mode-badge" class="badge">Mode —</span>
					<span id="run-status-badge" class="badge">Run —</span>
					<span id="capability-badge" class="badge" hidden></span>
					<span id="retry-status-badge" class="badge badge-warning" hidden>Retry —</span>
					<span id="header-network-badge" class="badge">Network —</span>
					<a id="attention-badge" class="badge attention-badge" hidden></a>
					<button id="refresh-button" class="button button-secondary" type="button">Refresh</button>
					<button id="pause-button" class="button" type="button" disabled>Pause bot</button>`,
	notices: `<section id="launch-notice" class="notice" aria-live="polite">
				<strong id="launch-notice-title">Checking execution network</strong>
				<span id="launch-notice-copy">Waiting for the selected network.</span>
			</section>
			<section id="notice" class="notice" aria-live="polite">
				<strong id="notice-title">Connecting to bot</strong>
				<span id="notice-copy">Waiting for the first local state snapshot.</span>
			</section>`,
	navigation: `<a href="/overview">Overview</a>
				<a href="/operations">Opportunities</a>
				<a href="/games">Games</a>
				<a href="/markets">Markets</a>
				<a href="/settings">Settings</a>
				<a href="/documentation">Operator guide</a>`,
})
