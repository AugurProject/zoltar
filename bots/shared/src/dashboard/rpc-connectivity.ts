/** Controls only: profile switching, validation, persistence and submit ownership stay in the bot. */
export function rpcConnectivityFields({
	independentQuorum = false,
	submissionLimit,
	statusId,
	statusText = 'Every endpoint is checked against the selected chain before it is accepted.',
	submitLabel = 'Check &amp; apply network',
}: {
	independentQuorum?: boolean
	submissionLimit?: number
	statusId: 'network-status' | 'connectivity-status'
	statusText?: string
	submitLabel?: string
}) {
	return `<div class="form-grid connectivity-grid">
 <label><span>Chain</span><select id="network-name" required><option value="mainnet">Ethereum mainnet · chain 1</option><option value="sepolia">Sepolia · chain 11155111</option></select></label>
 <label><span>RPC agreement requirement</span><select id="rpc-quorum" required><option value="1">1 · primary RPC only</option><option value="2">2 · require two agreeing independent RPCs</option></select></label>
 <label><span>Read RPC URL</span><input id="read-rpc-url" type="url" spellcheck="false" required /></label>
 <label><span>Public submission RPC URLs · one per line${submissionLimit === undefined ? '' : `, up to ${submissionLimit}`}</span><textarea id="public-rpc-urls" rows="3" spellcheck="false" required></textarea></label>
 ${independentQuorum ? '<label><span>Independent quorum RPC URLs · required when agreement is 2</span><textarea id="quorum-rpc-urls" rows="3" spellcheck="false"></textarea></label>' : ''}
 </div><div class="form-actions"><span id="${statusId}" class="action-status muted" role="status" aria-live="polite">${statusText}</span><button class="button" type="submit">${submitLabel}</button></div>`
}
