import { renderOperatorHeader } from '../../../shared/src/dashboard/header.ts'

export const operatorHeader = renderOperatorHeader({
	title: 'Zoltar chaos bot',
	eyebrow: 'Ecosystem operator',
	blockStatus: '<span id="last-block">Block —</span> · <span id="last-scan">Waiting for first scan</span>',
	safety: `<span id="mode-badge" class="badge">Starting</span>
					<span id="network-badge" class="badge">Network loading</span>
					<span id="signer-badge" class="badge">Signer loading</span>
					<a id="recovery-badge" class="badge hidden" href="/activity">Recovery items</a>
					<button id="refresh-button" class="secondary" type="button">Refresh</button>
					<button id="pause-button" class="secondary" type="button">Pause</button>
					<span id="pause-status" class="action-status" role="alert"></span>`,
	navigation: `<a href="/overview">Overview</a>
				<a href="/catalog">Operation catalog</a>
				<a href="/ecosystem">Ecosystem state</a>
				<a href="/activity">Activity &amp; recovery</a>
				<a href="/settings">Settings</a>`,
})
