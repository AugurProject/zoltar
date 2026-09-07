export function createTevmBufferImportPlugin() {
	return {
		name: 'tevm-buffer-import',
		setup(build: { onLoad(options: { filter: RegExp }, callback: (args: { path: string }) => Promise<{ contents: string; loader: 'js' }>): void }) {
			build.onLoad({ filter: /[/\\]@tevm[/\\]actions[/\\]dist[/\\]index\.js$/ }, async args => ({
				contents: `import { Buffer } from 'node:buffer'\n${await Bun.file(args.path).text()}`,
				loader: 'js',
			}))
		},
	}
}
