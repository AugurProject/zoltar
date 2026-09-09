import { renderOperatorHeader } from '../../../shared/src/dashboard/header.ts'

export const operatorHeader = renderOperatorHeader({
	title: 'Statoblast liquidator',
	eyebrow: 'Statoblast operator',
	blockStatus: 'Block — · waiting for first observation',
	safety: `<span id="mode-badge" class="badge">Starting</span>
					<span id="network-badge" class="badge">Network loading</span>
					<span id="run-status-badge" class="badge">Loading</span>
					<span id="capability-badge" class="badge">Capability loading</span>
					<a id="attention-badge" class="badge attention-badge">No blockers</a>
					<button id="refresh-button" class="secondary" type="button">Refresh</button>
					<button id="pause-button" class="secondary" type="button">Pause</button>
					<span id="pause-status" class="action-status" role="alert"></span>`,
	navigation: `<a href="/overview">Overview</a>
				<a href="/pools">Pool work</a>
				<a href="/markets">Market evidence</a>
				<a href="/operations">Activity &amp; recovery</a>
				<a href="/settings">Settings</a>`,
})
