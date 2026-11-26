"""Verify and replay the minimal INV-39 source closure, without cached proof oleans.

The manifest hashes exact source inputs, including freshly lowered model modules.
Use --refresh-hashes deliberately after regenerating models or editing proofs.
"""

import argparse
from graphlib import TopologicalSorter
import hashlib
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
MANIFEST = HERE / 'inv39-sources.json'


def local_imports(data, available):
    return [module for line in data.decode().splitlines() if line.startswith('import ')
            for module in line.split()[1:] if module in available]


def stage(models, work, refresh=False):
    manifest = json.loads(MANIFEST.read_text())
    rows = {row['module']: row for row in manifest['modules']}
    if len(rows) != len(manifest['modules']):
        raise ValueError('Duplicate INV-39 module')
    proof_root = REPO / 'formal/solidcore'
    available = set(rows) | {p.stem for p in proof_root.glob('inv*/*.lean')}
    graph = TopologicalSorter()
    seen = set()

    def visit(name):
        if name in seen:
            return
        seen.add(name)
        row = rows[name]
        relative = row['model_relative_path'] or row['path']
        if Path(relative).is_absolute() or '..' in Path(relative).parts:
            raise ValueError(f'Nonportable source path: {relative}')
        source = (models if row['model_relative_path'] else REPO) / relative
        data = source.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        imports = local_imports(data, available)
        for dependency in imports:
            if dependency not in rows:
                raise ValueError(f'{name}: missing manifest entry for {dependency}')
        if refresh:
            row['sha256'] = digest
            row['imports'] = imports
        elif digest != row['sha256'] or imports != row['imports']:
            raise ValueError(f'{name}: source hash/import mismatch: {source}')
        for dependency in imports:
            visit(dependency)
        graph.add(name, *imports)
        (work / (name + '.lean')).write_bytes(data)

    for entry in manifest['entries']:
        visit(entry)
    if seen != set(rows):
        raise ValueError(f'Unneeded modules in INV-39 manifest: {sorted(set(rows) - seen)}')
    order = list(graph.static_order())
    if refresh:
        manifest['topological_order'] = order
        MANIFEST.write_text(json.dumps(manifest, indent='\t') + '\n')
    elif order != manifest['topological_order']:
        raise ValueError('INV-39 topological order differs from source closure')
    print(f'Validated {len(rows)} INV-39 source hashes and exact import closure', flush=True)
    return order


def replay(models, solidcore, dry_run=False, refresh=False):
    with TemporaryDirectory(prefix='inv39-') as directory:
        work = Path(directory)
        order = stage(models, work, refresh)
        if dry_run:
            return
        lean_path = subprocess.check_output(
            ['lake', 'env', 'printenv', 'LEAN_PATH'], cwd=solidcore, text=True,
        ).strip()
        env = {**os.environ, 'LEAN_PATH': str(work) + os.pathsep + lean_path}
        for name in order:
            print(name, flush=True)
            subprocess.run(
                ['lean', '--root=' + str(work), '-s', '131072', '-o',
                 work / (name + '.olean'), work / (name + '.lean')],
                cwd=solidcore, env=env, check=True,
            )


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--models', required=True, type=Path)
    cli.add_argument('--solidcore', type=Path)
    cli.add_argument('--dry-run', action='store_true')
    cli.add_argument('--refresh-hashes', action='store_true')
    args = cli.parse_args()
    if not args.dry_run and args.solidcore is None:
        cli.error('--solidcore is required unless --dry-run is set')
    replay(args.models.resolve(), args.solidcore.resolve() if args.solidcore else None,
           args.dry_run, args.refresh_hashes)
