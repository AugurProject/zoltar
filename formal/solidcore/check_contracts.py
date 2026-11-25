"""Compile Zoltar declarations with the patched SolidCore source interpreter.

Requires Python 3.10+, Bun with repository dependencies, Forge 1.5.1, both native
solc versions and the patched SolidCore checkout. Run with --help for options.
Only the checked source lowering can report success. Exit 1 means some targets
remain unsupported. The TSV identifies each target and its first diagnostic.
"""

import argparse
import collections
from concurrent.futures import ThreadPoolExecutor
import csv
import json
import os
from pathlib import Path
import subprocess
import sys
import shutil
from tempfile import TemporaryDirectory
from threading import Lock

ROOT = Path(__file__).resolve().parents[2]
ORACLE = 'contracts/statoblast/openOracle/'
DUMP = """
import {loadContractSources,createMainCompilerSources,createOpenOracleCompilerSources} from './solidity/ts/compile.ts'
const sources=await loadContractSources()
console.log(JSON.stringify([Object.fromEntries(createMainCompilerSources(sources)),Object.fromEntries(createOpenOracleCompilerSources(sources))]))
"""


def read_ast(compiler, sources, parse_only=False):
    settings = {'outputSelection': {'*': {'': ['ast']}}}
    if parse_only:
        settings['stopAfter'] = 'parsing'
    request = {
        'language': 'Solidity',
        'sources': {key: {'content': src} for key, src in sources.items()},
        'settings': settings,
    }
    result = json.loads(
        subprocess.check_output(
            [compiler, '--standard-json'], input=json.dumps(request), text=True
        )
    )
    errors = [
        e['formattedMessage']
        for e in result.get('errors', [])
        if e['severity'] == 'error'
    ]
    if errors:
        raise ValueError('\n'.join(errors))
    return {key: s['ast'] for key, s in result['sources'].items()}


def order_bases(source, compiler):
    nodes = read_ast(compiler, {'Flat.sol': source}, True)['Flat.sol']['nodes']
    by_name = {
        n['name']: i
        for i, n in enumerate(nodes)
        if n['nodeType'] == 'ContractDefinition'
    }
    data = source.encode()
    chunks = []
    end = 0
    for node in nodes:
        start, length, _ = map(int, node['src'].split(':'))
        chunks.append(data[end : start + length])
        end = start + length
    order = []
    seen = set()

    def visit(i):
        if i not in seen:
            seen.add(i)
            for base in nodes[i].get('baseContracts', []):
                visit(by_name[base['baseName']['name']])
            order.append(i)

    for i in range(len(nodes)):
        visit(i)
    return (b'\n'.join(chunks[i] for i in order) + data[end:]).decode()


def root_path(key, oracle):
    if not oracle:
        return (
            key if key.startswith('contracts/') and not key.startswith(ORACLE) else None
        )
    if key == 'src/OpenOracleSlim.sol':
        return ORACLE + 'OpenOracle.sol'
    if key.startswith('src/'):
        return ORACLE + key.removeprefix('src/')
    if key.startswith('@openzeppelin/'):
        return ORACLE + key.removeprefix('@')
    raise ValueError(f'unknown oracle source {key}')


def check(args, work):
    sys.path[:0] = [
        str(args.solidcore / 'prototypes/source'),
        str(args.solidcore / 'scripts'),
    ]
    from assembly import Unsupported, lower_assembly
    from project import project
    import solc_ast_to_lean_source as importer

    render_lock = Lock()  # The upstream renderer has per-call module globals.
    lean_env = {
        **os.environ,
        'LEAN_PATH': subprocess.check_output(
            ['lake', 'env', 'printenv', 'LEAN_PATH'], cwd=args.solidcore, text=True
        ).strip(),
    }
    jobs = []
    profiles = json.loads(
        subprocess.check_output(['bun', '-e', DUMP], cwd=ROOT, text=True)
    )
    for oracle, sources in enumerate(profiles):
        compiler = args.oracle_solc if oracle else args.solc
        version = '0.8.28+commit.7893614a' if oracle else '0.8.35+commit.47b9dedd'
        if version not in subprocess.check_output([compiler, '--version'], text=True):
            raise ValueError(f'expected {version}')
        asts = read_ast(compiler, sources)
        directory = work / ('oracle' if oracle else 'main')
        for key, src in sources.items():
            dest = directory / key
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(src)
        for key, ast in asts.items():
            path = root_path(key, oracle)
            if path:
                names = [
                    n['name']
                    for n in ast['nodes']
                    if n['nodeType'] == 'ContractDefinition'
                ]
                jobs.append((key, path, names, compiler, directory))
    if {j[1] for j in jobs} != {
        str(p.relative_to(ROOT / 'solidity'))
        for p in (ROOT / 'solidity/contracts').rglob('*.sol')
    }:
        raise ValueError('profile coverage differs from repository sources')

    def lower_file(item):
        index, (key, path, names, compiler, directory) = item
        if not names:
            return [(path, '', 'no named declaration', '')]
        env = {**os.environ, 'FOUNDRY_SOLC': compiler, 'FOUNDRY_OFFLINE': 'true'}
        flat = work / f'Flat{index}.sol'
        subprocess.run(
            [
                args.forge,
                'flatten',
                '--root',
                directory,
                '-j',
                '1',
                directory / key,
                '-o',
                flat,
            ],
            cwd=directory,
            env=env,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        text = flat.read_text()
        try:
            ast = read_ast(compiler, {'Flat.sol': text})['Flat.sol']
        except ValueError as exc:
            if 'Definition of base has to precede' not in str(exc):
                raise
            ast = read_ast(compiler, {'Flat.sol': order_bases(text, compiler)})[
                'Flat.sol'
            ]
        result = []
        for i, name in enumerate(names):
            ns = f'SolidCore.Solidity.Target{index}_{i}'
            try:
                selected = project(ast, name)
                root = next(
                    node
                    for node in selected['nodes']
                    if node.get('nodeType') == 'ContractDefinition'
                    and node['name'] == name
                )
                check_constructor = (
                    root['contractKind'] == 'contract' and not root['abstract']
                )
                target = lower_assembly(selected)
                with render_lock:
                    code = importer.render_module(
                        target,
                        key,
                        name,
                        ns,
                        True,
                        analyzed_solc_028=compiler == args.oracle_solc,
                    )
            except (Unsupported, importer.ImportError) as exc:
                result.append((path, name, 'frontend rejected', str(exc)))
                continue
            script = work / (ns + '.lean')
            success = (
                'if (contract.program.constructorFunctionFor? contract.decl).isSome then "PASS" else "FAIL constructor translation"'
                if check_constructor
                else '"PASS"'
            )
            script.write_text(
                'import SolidCore.Solidity.Checked\n'
                + code
                + f"""
#eval match SolidCore.Solidity.TypeCheck.CheckedInput.contract {ns}.importedSourceUnit {json.dumps(name)} with
      | .ok {'contract' if check_constructor else '_'} => {success}
      | .error e => "FAIL " ++ reprStr e
"""
            )
            p = subprocess.run(
                [
                    'lean',
                    '-s',
                    '131072',
                    '-DmaxRecDepth=32768',
                    '-DmaxHeartbeats=20000000',
                    script,
                ],
                cwd=args.solidcore,
                env=lean_env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            msg = p.stdout.strip()
            if p.returncode:
                result.append((path, name, 'Lean error', msg))
            else:
                try:
                    value = json.loads(msg.splitlines()[-1] if msg else '')
                except json.JSONDecodeError:
                    result.append((path, name, 'Lean output error', msg))
                    continue
                if value == 'PASS':
                    if args.models is not None:
                        output = args.models / path / (name + '.lean')
                        output.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(script, output)
                    result.append((path, name, 'lowered', ''))
                elif value.startswith('FAIL '):
                    result.append((path, name, 'checked lowering rejected', value[5:]))
                else:
                    raise RuntimeError(value)
        return result

    def unit(item):
        _, (_, path, names, _, _) = item
        try:
            return lower_file(item)
        except (ValueError, subprocess.CalledProcessError) as exc:
            detail = str(exc)
            if isinstance(exc, subprocess.CalledProcessError) and exc.stderr:
                detail += ' ' + exc.stderr
            return [(path, name, 'source preparation failed', detail) for name in names]

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        rows = sorted(r for batch in pool.map(unit, enumerate(jobs)) for r in batch)
    with args.report.open('w') as f:
        w = csv.writer(f, delimiter='\t', lineterminator='\n')
        w.writerow(['source', 'declaration', 'result', 'diagnostic'])
        for path, name, status, detail in rows:
            w.writerow([path, name, status, ' '.join(detail.split())])
    counts = collections.Counter(r[2] for r in rows if r[1])
    print(dict(counts), flush=True)
    return counts['lowered'] == sum(counts.values())


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--solidcore', required=True, type=Path)
    cli.add_argument('--solc', required=True)
    cli.add_argument('--oracle-solc', required=True)
    cli.add_argument('--forge', default='forge')
    cli.add_argument('--jobs', type=int, default=3)
    cli.add_argument('--report', type=Path, required=True)
    cli.add_argument(
        '--models',
        type=Path,
        help='write passing Lean source modules to a new directory',
    )
    args = cli.parse_args()
    if args.models is not None:
        args.models.mkdir(parents=True, exist_ok=False)
    args.solidcore = args.solidcore.resolve()
    with TemporaryDirectory() as work:
        sys.exit(0 if check(args, Path(work)) else 1)
