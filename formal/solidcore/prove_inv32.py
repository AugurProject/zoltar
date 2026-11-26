"""Replay the Lean invariant proofs against source models produced by check_contracts.py."""

import argparse
from graphlib import TopologicalSorter
import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory


def prove(models, solidcore, with_pair=False, with_thresholds=False, with_index=False, with_settlement=False):
    harness = 'TwoWayConstantProductMathHarness'
    model = models / 'contracts/trading/test' / (harness + '.sol') / (harness + '.lean')
    here = Path(__file__).parent
    with TemporaryDirectory(prefix='inv32-') as directory:
        work = Path(directory)
        shutil.copyfile(model, work / 'Inv32Generated.lean')
        # Require each public proof even if its entry module is accidentally removed.
        entries = [(number, f'Inv{number}Proved.lean') for number in range(32, 37)]
        entries.append((37, 'Inv37Backing.lean'))
        if with_thresholds:
            entries.append((40, 'Inv40GeneratedThresholds.lean'))
            zoltar = models / 'contracts/Zoltar.sol/Zoltar.lean'
            shutil.copyfile(zoltar, work / 'Inv40Generated.lean')
        if with_index:
            index = models / 'contracts/statoblast/SecurityPoolCommitmentIndex.sol/SecurityPoolCommitmentIndex.lean'
            shutil.copyfile(index, work / 'Inv01Generated.lean')
            entries.extend([('01', 'Inv01PriceBoundary.lean'), ('02', 'Inv02Proved.lean')])
        if with_settlement:
            settlement = models / 'contracts/test/statoblast/InvariantMathHarness.sol/InvariantMathHarness.lean'
            shutil.copyfile(settlement, work / 'Inv27Generated.lean')
            entries.extend([('03', 'Inv03Proved.lean'), ('04', 'Inv04Proved.lean'), ('05', 'Inv05Proved.lean'), (27, 'Inv27Counterexample.lean')])
        for number, name in entries:
            proof_sources = here / f'inv{number}'
            if not (proof_sources / name).is_file():
                raise FileNotFoundError(proof_sources / name)
            for source in proof_sources.glob('*.lean'):
                shutil.copyfile(source, work / source.name)
        if with_pair:
            pair = 'TwoWayConstantProductPair'
            pair_model = models / 'contracts/trading' / (pair + '.sol') / (pair + '.lean')
            shutil.copyfile(pair_model, work / 'Inv37PairGenerated.lean')
            shutil.copyfile(here / 'pair/Inv37PairGuard.lean', work / 'Inv37PairGuard.lean')
        modules = {source.stem: source for source in work.glob('*.lean')}
        deps = TopologicalSorter()
        for name, source in modules.items():
            imports = [
                module
                for line in source.read_text().splitlines()
                if line.startswith('import ')
                for module in line.split()[1:]
                if module in modules
            ]
            deps.add(name, *imports)
        lean_path = subprocess.check_output(
            ['lake', 'env', 'printenv', 'LEAN_PATH'], text=True, cwd=solidcore
        ).strip()
        env = {**os.environ, 'LEAN_PATH': str(work) + os.pathsep + lean_path}
        for name in deps.static_order():
            subprocess.run(
                ['lean', '--root=' + str(work), '-s', '131072', '-o',
                 work / (name + '.olean'), modules[name]],
                env=env, cwd=solidcore, check=True,
            )


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('models', type=Path, help='checked modules directory')
    cli.add_argument('solidcore', type=Path, help='patched SolidCore checkout')
    cli.add_argument('--with-pair', action='store_true', help='also check the generated pair reserve guard')
    cli.add_argument('--with-thresholds', action='store_true', help='also check the generated Zoltar threshold getters')
    cli.add_argument('--with-index', action='store_true', help='also check the commitment-index price proofs')
    cli.add_argument('--with-settlement', action='store_true', help='also check the settlement and oracle math harness')
    args = cli.parse_args()
    prove(args.models.resolve(), args.solidcore.resolve(), args.with_pair, args.with_thresholds, args.with_index, args.with_settlement)
