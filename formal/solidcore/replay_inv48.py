"""Stage the hash-pinned INV48 explicit source closure; replay is opt-in.

Libraries and lowered models are supplied externally, never vendored. Replay uses
complete pinned prebuilt dependencies and freshly compiles project sources only.
Dry runs validate source identity/imports, not theorem compatibility.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
MANIFEST = HERE / 'inv48-sources.json'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def imports(data):
    text = data.decode()
    clean = []
    index = depth = 0
    while index < len(text):
        pair = text[index:index + 2]
        if pair == '/-':
            depth += 1
            index += 2
        elif depth and pair == '-/':
            depth -= 1
            index += 2
            clean.append(' ')
        elif depth:
            index += 1
        elif pair == '--':
            end = text.find('\n', index)
            index = len(text) if end < 0 else end
        else:
            clean.append(text[index])
            index += 1
    result = []
    for line in ''.join(clean).splitlines():
        line = line.strip()
        if not line or line in ('prelude', 'module'):
            continue
        match = re.fullmatch(r'(?:(?:public|meta)\s+)*import\s+([A-Za-z0-9_. ]+)', line)
        if not match:
            break
        result.extend(name for name in match[1].split() if name != 'all')
    return result

def stage(models, solidcore, toolchain, work):
    manifest = json.loads(MANIFEST.read_text())
    registry_data = (HERE / 'inv39-sources.json').read_bytes()
    if digest(registry_data) != manifest['inv39_registry_sha256']:
        raise ValueError('INV39 registry hash mismatch')
    registry = {row['module']: row for row in json.loads(registry_data)['modules']}
    roots = dict(repo=REPO, models=models, solidcore=solidcore, toolchain=toolchain)
    rows = manifest['modules']
    data = {}
    order = []
    active = set()

    def visit(name):
        if name in active:
            raise ValueError(f'Import cycle: {name}')
        if name in data:
            return
        if name not in rows:
            raise ValueError(f'Missing registered source: {name}')
        active.add(name)
        row = rows[name]
        if 'inv39' in row:
            old = registry[row['inv39']]
            row = dict(root='models' if old['model_relative_path'] else 'repo',
                       relative_path=old['model_relative_path'] or old['path'], sha256=old['sha256'])
        relative = Path(row['relative_path'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError(f'Nonportable source path: {relative}')
        source = roots[row['root']] / relative
        content = source.read_bytes()
        if digest(content) != row['sha256']:
            raise ValueError(f'{name}: source hash mismatch: {source}')
        deps = imports(content)
        if 'imports' in row and deps != row['imports']:
            raise ValueError(f'{name}: import mismatch')
        data[name] = content
        for dep in sorted(set(deps)):
            visit(dep)
        active.remove(name)
        order.append(name)

    for entry in sorted(manifest['entries']):
        visit(entry)
    if set(data) != set(rows) or order != manifest['topological_order']:
        raise ValueError('Manifest differs from exact dependency-first closure')
    checksums = ''.join(f'{digest(data[name])}  {name.replace(".", "/")}.lean\n' for name in sorted(data))
    if digest(checksums.encode()) != manifest['closure_sha256']:
        raise ValueError('Closure hash mismatch')
    if work.exists():
        raise ValueError('Use a new staging directory')
    work.mkdir(parents=True)
    for name in order:
        target = work / (name.replace('.', '/') + '.lean')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data[name])
    (work / 'SHA256SUMS').write_text(checksums)
    portable = dict(entries=manifest['entries'], topological_order=order,
                    closure_sha256=digest(checksums.encode()),
                    modules={name: dict(sha256=digest(content), imports=imports(content))
                             for name, content in sorted(data.items())},
                    implicit_toolchain_closure_certified=False, proof_replay_certified=False)
    (work / 'manifest.json').write_text(json.dumps(portable, indent=2) + '\n')
    verify(work)
    print(f'Validated {len(data)} explicit source inputs; closure SHA256 {digest(checksums.encode())}', flush=True)
    return manifest, order

def verify(work):
    """Verify a relocated source bundle without consulting original locations."""
    manifest = json.loads((work / 'manifest.json').read_text())
    seen = set()
    rows = manifest['modules']
    for name in manifest['topological_order']:
        relative = Path(name.replace('.', '/') + '.lean')
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Nonportable module name')
        content = (work / relative).read_bytes()
        row = rows[name]
        if digest(content) != row['sha256'] or imports(content) != row['imports']:
            raise ValueError(f'{name}: staged source mismatch')
        if not set(row['imports']) <= seen or name in seen:
            raise ValueError('Invalid staged dependency order')
        seen.add(name)
    if seen != set(rows) or not set(manifest['entries']) <= seen:
        raise ValueError('Incomplete staged closure')
    checksums = ''.join(f'{row["sha256"]}  {name.replace(".", "/")}.lean\n'
                        for name, row in sorted(rows.items()))
    if (work / 'SHA256SUMS').read_text() != checksums or digest(checksums.encode()) != manifest['closure_sha256']:
        raise ValueError('Staged checksum mismatch')


ALLOWED_AXIOMS = {'propext', 'Classical.choice', 'Quot.sound',
                  'Lean.ofReduceBool', 'Lean.trustCompiler'}
ENDPOINT_ROOTS = {
    'Inv48RawPriceMonotoneAudit': [
        'Inv48.RawPriceMonotone.' + name for name in
        ('observationFromRaw', 'recover', 'exportComparison', 'outputDecoded', 'decodedComparison')],
    'Inv48FinalObservedTransferAudit': [
        'Inv48.FinalObservedTransfer.' + name for name in
        ('suffixExact', 'atSharedInvocation', 'fundingOfRecovered', 'actualChildTransfer',
         'simpleRaw', 'operationsRaw')],
}


def command(args, cwd, env):
    return subprocess.check_output(args, cwd=cwd, env=env, text=True).strip()


def environment(solidcore, toolchain, manifest):
    env = {**os.environ, 'PATH': str(toolchain / 'bin') + os.pathsep + os.environ['PATH'],
           'LEAN_NUM_THREADS': '1', 'MALLOC_ARENA_MAX': '2'}
    # Never accept a caller's project search path in the dependency environment.
    env.pop('LEAN_PATH', None)
    lean = toolchain / 'bin/lean'
    if digest(lean.read_bytes()) != manifest['lean_binary_sha256']:
        raise ValueError('Pinned Lean binary hash mismatch')
    if command(['git', 'rev-parse', 'HEAD'], solidcore, env) != manifest['solidcore_revision']:
        raise ValueError('SolidCore revision mismatch')
    patch = HERE / 'solidcore.patch'
    if digest(patch.read_bytes()) != manifest['solidcore_patch_sha256']:
        raise ValueError('SolidCore patch hash mismatch')
    # Compare the entire tracked patch, including unexpected extra edits.
    with TemporaryDirectory(prefix='inv48-index-') as directory:
        index_env = {**env, 'GIT_INDEX_FILE': str(Path(directory) / 'index')}
        command(['git', 'read-tree', 'HEAD'], solidcore, index_env)
        command(['git', 'apply', '--cached', str(patch)], solidcore, index_env)
        names = command(['git', 'diff', '--cached', '--name-only', 'HEAD'], solidcore, index_env).splitlines()
        for name in names:
            expected = subprocess.check_output(['git', 'show', ':' + name], cwd=solidcore, env=index_env)
            if (solidcore / name).read_bytes() != expected:
                raise ValueError('SolidCore patched file mismatch: ' + name)
    changed = command(['git', 'diff', '--name-only', 'HEAD'], solidcore, env).splitlines()
    if not set(changed) <= set(names):
        raise ValueError('Unexpected SolidCore tracked edits')
    if command(['lake', 'env', 'which', 'lean'], solidcore, env) != str(lean):
        raise ValueError('Lake selected a different Lean compiler')
    version = command([str(lean), '--version'], solidcore, env)
    if not version.startswith('Lean (version ' + manifest['lean_version'] + ','):
        raise ValueError('Lean version mismatch')
    if (solidcore / 'lean-toolchain').read_text().strip() != 'leanprover/lean4:v' + manifest['lean_version']:
        raise ValueError('Lake toolchain pin mismatch')
    packages = json.loads((solidcore / 'lake-manifest.json').read_text())['packages']
    roots = [toolchain, solidcore / '.lake/build']
    for package in packages:
        root = solidcore / '.lake/packages' / package['name'].strip('«»')
        if command(['git', 'rev-parse', 'HEAD'], root, env) != package['rev']:
            raise ValueError('Lake package revision mismatch: ' + str(root))
        if command(['git', 'status', '--porcelain', '--untracked-files=no'], root, env):
            raise ValueError('Dirty Lake package: ' + str(root))
        roots.append(root)
    paths = command(['lake', 'env', 'printenv', 'LEAN_PATH'], solidcore, env).split(os.pathsep)
    env['LEAN_PATH'] = os.pathsep.join(str((solidcore / path).resolve()) for path in paths)
    # Snapshot complete dependencies, including native resources and data files.
    hashes = {}
    for root in roots:
        if not root.is_dir():
            raise ValueError('Missing complete dependency tree: ' + str(root))
        for path in sorted(root.rglob('*')):
            if path.is_file() and '.git' not in path.parts:
                hashes[str(path.resolve())] = digest(path.read_bytes())
    for path in (solidcore / 'lake-manifest.json', solidcore / 'lean-toolchain', lean):
        hashes[str(path)] = digest(path.read_bytes())
    return env, hashes, version


def check_axioms(output, roots):
    found = {}
    for name, values in re.findall(r"'([^']+)' depends on axioms: \[([^\]]*)\]", output):
        found[name] = set(values.replace('\n', ' ').replace(',', ' ').split())
    for name in re.findall(r"'([^']+)' does not depend on any axioms", output):
        found[name] = set()
    if set(found) != set(roots):
        raise ValueError('Missing or unexpected endpoint axiom traversal')
    for name, axioms in found.items():
        if not axioms <= ALLOWED_AXIOMS:
            raise ValueError(f'{name}: forbidden axioms: {sorted(axioms - ALLOWED_AXIOMS)}')
    return {name: sorted(values) for name, values in found.items()}


def replay(models, solidcore, toolchain, work, dry_run, smoke_only=False):
    manifest, order = stage(models, solidcore, toolchain, work)
    if dry_run:
        return
    if set(manifest['entries']) != set(ENDPOINT_ROOTS):
        raise ValueError('Unexpected final endpoints')
    if smoke_only and 'Inv08Generated' not in order:
        raise ValueError('Smoke requires registered Inv08Generated')
    env, hashes, version = environment(solidcore, toolchain, manifest)
    (work / 'dependencies.json').write_text(json.dumps(dict(
        version=version, hashes=hashes, lean_path=env['LEAN_PATH'],
        trust='Prebuilt pinned complete Lake packages, patched SolidCore and installed toolchain; '
              'snapshot identity is not historical build provenance.'), indent=2) + '\n')
    objects = work / 'objects'
    objects.mkdir()
    env['LEAN_PATH'] = str(objects) + os.pathsep + env['LEAN_PATH']

    def compile_source(source, output=None):
        args = [str(toolchain / 'bin/lean'), '-j1', '--root=' + str(work),
                '-s', '131072', '-M', '10000', '-DElab.async=false']
        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            args += ['-o', str(output)]
        result = command([*args, str(source)], work, env)
        print(result, flush=True)
        return result

    smoke = work / 'ReplaySmoke.lean'
    smoke.write_text('import Mathlib.Data.Nat.Basic\nimport SolidCore.Solidity.Checked\n#check Nat.add_comm\n')
    compile_source(smoke)
    for name in order:
        row = manifest['modules'][name]
        # Library sources are validated by stage, but only project/generated sources
        # produce new objects. Complete Lake resources remain in their normal trees.
        if row.get('root') in ('toolchain', 'solidcore'):
            continue
        if smoke_only and name != 'Inv08Generated':
            continue
        compile_source(work / (name.replace('.', '/') + '.lean'),
                       objects / (name.replace('.', '/') + '.olean'))
    if not smoke_only:
        audit = {}
        for entry, roots in ENDPOINT_ROOTS.items():
            source = work / 'EndpointAxioms.lean'
            source.write_text('import ' + entry + '\n' + ''.join(
                '#print axioms ' + root + '\n' for root in roots))
            audit[entry] = check_axioms(compile_source(source), roots)
        (work / 'endpoint-axioms.json').write_text(json.dumps(audit, indent=2) + '\n')
    verify(work)
    for path, expected in hashes.items():
        if digest(Path(path).read_bytes()) != expected:
            raise ValueError('Dependency changed during replay: ' + path)
    print('Bounded dependency smoke passed' if smoke_only else 'Final endpoint axiom checks passed', flush=True)

if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ('models', 'solidcore', 'toolchain'):
        cli.add_argument('--' + name, type=Path)
    cli.add_argument('--out', type=Path)
    cli.add_argument('--verify', type=Path, help='verify a relocated source bundle only')
    cli.add_argument('--dry-run', action='store_true')
    cli.add_argument('--smoke-only', action='store_true', help='only dependency smoke and Inv08Generated; no endpoint certification')
    args = cli.parse_args()
    if args.verify:
        verify(args.verify.resolve())
        raise SystemExit(0)
    if not all((args.models, args.solidcore, args.toolchain)):
        cli.error('--models, --solidcore and --toolchain are required for staging/replay')
    if args.out:
        replay(args.models.resolve(), args.solidcore.resolve(), args.toolchain.resolve(), args.out.resolve(), args.dry_run, args.smoke_only)
    else:
        with TemporaryDirectory(prefix='inv48-') as directory:
            replay(args.models.resolve(), args.solidcore.resolve(), args.toolchain.resolve(), Path(directory) / 'sources', args.dry_run, args.smoke_only)
