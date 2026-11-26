"""Rebuild the INV-32 theorem from a checked source model produced by check_contracts.py."""

import argparse
from graphlib import TopologicalSorter
import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory


def prove(models, solidcore):
    harness = 'TwoWayConstantProductMathHarness'
    model = models / 'contracts/trading/test' / (harness + '.sol') / (harness + '.lean')
    sources = Path(__file__).with_name('inv32')
    with TemporaryDirectory(prefix='inv32-') as directory:
        work = Path(directory)
        shutil.copyfile(model, work / 'Inv32Generated.lean')
        # Require the public theorem even if its file is accidentally deleted or renamed.
        if not (sources / 'Inv32Proved.lean').is_file():
            raise FileNotFoundError(sources / 'Inv32Proved.lean')
        for source in sources.glob('*.lean'):
            shutil.copyfile(source, work / source.name)
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
    args = cli.parse_args()
    prove(args.models.resolve(), args.solidcore.resolve())
