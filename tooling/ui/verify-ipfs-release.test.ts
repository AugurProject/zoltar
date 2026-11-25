import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repositoryRoot } from '../repo/root.mts'
import { UI_APP_IDS } from './appPaths.mts'

test('release verification requires identical entry points and nested assets for every app', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'verify-release-'))
	try {
		const env: Record<string, string | undefined> = { ...process.env, BASH_ENV: join(directory, 'gateway.sh'), GATEWAY_FIXTURE: join(directory, 'gateway'), IPFS_GATEWAY: 'https://gateway.example' }
		// Replace only the network boundary. Resolve directory requests as the gateway would.
		await writeFile(
			join(directory, 'gateway.sh'),
			`curl() {
			local url="" output=""
			while (( $# )); do
				case "$1" in https://gateway.example/ipfs/*) url="\${1#https://gateway.example/ipfs/}";; -o) shift; output="$1";; esac
				shift
			done
			[[ -n "$url" && -n "$output" ]] || return 1
			if [[ "$url" == */ ]]; then url+="index.html"; fi
			cp "$GATEWAY_FIXTURE/$url" "$output"
		}`,
		)
		for (const app of UI_APP_IDS) {
			const cid = 'bafy' + app
			env[app.toUpperCase() + '_IPFS_CID'] = cid
			const root = join(directory, 'export', app)
			await mkdir(join(root, 'assets'), { recursive: true })
			await writeFile(join(root, 'index.html'), app)
			await writeFile(join(root, 'assets', 'entry.js'), app + ' script')
			await cp(root, join(directory, 'gateway', cid), { recursive: true })
		}
		const verify = () => spawnSync('bash', [join(repositoryRoot, 'tooling/ui/verify-ipfs-release.sh'), join(directory, 'export')], { env }).status
		expect(verify()).toBe(0)
		const asset = join(directory, 'gateway', 'bafytrading', 'assets', 'entry.js')
		await writeFile(asset, 'substituted contents')
		expect(verify()).not.toBe(0)
		await rm(asset)
		expect(verify()).not.toBe(0)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
