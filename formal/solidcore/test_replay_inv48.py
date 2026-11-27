"""Focused closure, environment, compilation selection and axiom enforcement tests."""

import json
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import replay_inv48

class ClosureTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory(prefix='inv48-integration-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.registry = self.root / 'inv39-sources.json'
        self.registry.write_text(json.dumps({'modules': [dict(
            module='Existing', path='Existing.lean', model_relative_path=None,
            sha256=replay_inv48.digest(b'-- registered source\n'),
        )]}))
        (self.root / 'Existing.lean').write_bytes(b'-- registered source\n')
        (self.root / 'Model.lean').write_bytes(b'import Existing\n')
        (self.root / 'Entry.lean').write_bytes(b'/- nested /- import Poison -/ -/\nimport Model\n')
        self.manifest = dict(
            entries=['Entry'], inv39_registry_sha256=replay_inv48.digest(self.registry.read_bytes()),
            modules={'Existing': {'inv39': 'Existing'}},
            topological_order=['Existing', 'Model', 'Entry'],
        )
        for name in ('Model', 'Entry'):
            data = (self.root / (name + '.lean')).read_bytes()
            self.manifest['modules'][name] = dict(
                root='models' if name == 'Model' else 'repo', relative_path=name + '.lean',
                sha256=replay_inv48.digest(data), imports=replay_inv48.imports(data),
            )
        checksums = ''.join(f'{replay_inv48.digest((self.root / (name + ".lean")).read_bytes())}  {name}.lean\n'
                            for name in sorted(self.manifest['modules']))
        self.manifest['closure_sha256'] = replay_inv48.digest(checksums.encode())
        self.path = self.root / 'manifest.json'
        for name, value in [('HERE', self.root), ('REPO', self.root), ('MANIFEST', self.path)]:
            patcher = patch.object(replay_inv48, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def stage(self, suffix='stage'):
        self.path.write_text(json.dumps(self.manifest))
        return replay_inv48.stage(self.root, self.root, self.root, self.root / suffix)

    def test_staging_is_dependency_first_and_reproducible(self):
        self.assertEqual(self.stage()[1], ['Existing', 'Model', 'Entry'])
        self.stage('repeat')
        self.assertEqual((self.root / 'stage/SHA256SUMS').read_bytes(),
                         (self.root / 'repeat/SHA256SUMS').read_bytes())
        self.assertEqual(list((self.root / 'stage').rglob('*.olean')), [])

    def test_changed_model_and_registered_proof_are_rejected_before_staging(self):
        for name in ('Model', 'Existing'):
            with self.subTest(name=name):
                path = self.root / (name + '.lean')
                original = path.read_bytes()
                path.write_bytes(b'-- poisoned\n')
                with self.assertRaisesRegex(ValueError, 'source hash mismatch'):
                    self.stage()
                self.assertFalse((self.root / 'stage').exists())
                path.write_bytes(original)

    def test_missing_import_and_cycle_are_rejected(self):
        del self.manifest['modules']['Existing']
        with self.assertRaisesRegex(ValueError, 'Missing registered source'):
            self.stage()
        self.manifest['modules']['Existing'] = dict(
            root='repo', relative_path='Entry.lean',
            sha256=replay_inv48.digest((self.root / 'Entry.lean').read_bytes()),
        )
        with self.assertRaisesRegex(ValueError, 'Import cycle'):
            self.stage()

    def test_paths_order_and_unused_rows_are_rejected(self):
        self.manifest['modules']['Entry']['relative_path'] = '../Entry.lean'
        with self.assertRaisesRegex(ValueError, 'Nonportable'):
            self.stage()
        self.manifest['modules']['Entry']['relative_path'] = 'Entry.lean'
        self.manifest['topological_order'].reverse()
        with self.assertRaisesRegex(ValueError, 'dependency-first closure'):
            self.stage()

    def test_closure_digest_and_unreachable_rows_are_rejected(self):
        original = self.manifest['closure_sha256']
        self.manifest['closure_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'Closure hash mismatch'):
            self.stage()
        self.manifest['closure_sha256'] = original
        self.manifest['modules']['Unused'] = dict(self.manifest['modules']['Model'])
        with self.assertRaisesRegex(ValueError, 'dependency-first closure'):
            self.stage()

    def test_registry_identity_is_mandatory(self):
        self.registry.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'registry hash mismatch'):
            self.stage()

    def test_relocated_bundle_verifies_without_original_sources(self):
        self.stage()
        relocated = self.root / 'relocated'
        shutil.copytree(self.root / 'stage', relocated)
        for name in ('Entry', 'Model', 'Existing'):
            (self.root / (name + '.lean')).unlink()
        self.path.unlink()
        self.registry.unlink()
        replay_inv48.verify(relocated)
        (relocated / 'Model.lean').write_text('-- poisoned\n')
        with self.assertRaisesRegex(ValueError, 'staged source mismatch'):
            replay_inv48.verify(relocated)

    def test_dry_run_never_launches_lean(self):
        self.path.write_text(json.dumps(self.manifest))
        with patch.object(replay_inv48.subprocess, 'run') as run:
            replay_inv48.replay(self.root, self.root, self.root, self.root / 'stage', True)
        run.assert_not_called()

    def test_recursive_axiom_output_is_enforced(self):
        roots = ['Endpoint.first', 'Endpoint.second']
        valid = ("'Endpoint.first' depends on axioms: [propext, Classical.choice,\n Quot.sound]\n"
                 "'Endpoint.second' does not depend on any axioms\n")
        self.assertEqual(replay_inv48.check_axioms(valid, roots)['Endpoint.second'], [])
        for output in (valid.replace('propext', 'sorryAx'),
                       valid.replace('propext', 'Custom.unsound'),
                       valid.splitlines()[0], ''):
            with self.subTest(output=output), self.assertRaises(ValueError):
                replay_inv48.check_axioms(output, roots)

    def test_replay_uses_lake_dependencies_and_fresh_project_objects(self):
        self.path.write_text(json.dumps(self.manifest))
        self.manifest['entries'] = ['Entry']
        self.path.write_text(json.dumps(self.manifest))
        dependency = dict(root='solidcore', relative_path='Existing.lean',
                          sha256=replay_inv48.digest((self.root / 'Existing.lean').read_bytes()))
        self.manifest['modules']['Existing'] = dependency
        self.path.write_text(json.dumps(self.manifest))
        roots = {'Entry': ['Endpoint.final']}
        calls = []
        def run(args, cwd, env):
            calls.append((args, cwd, env.copy()))
            return "'Endpoint.final' depends on axioms: [propext]"
        with patch.object(replay_inv48, 'ENDPOINT_ROOTS', roots), \
                patch.object(replay_inv48, 'environment', return_value=(
                    {'LEAN_PATH': '/complete/lake/build'}, {}, 'pinned')), \
                patch.object(replay_inv48, 'command', side_effect=run):
            replay_inv48.replay(self.root, self.root, self.root, self.root / 'stage', False)
        compiled = [Path(args[-1]).stem for args, _, _ in calls]
        self.assertEqual(compiled, ['ReplaySmoke', 'Model', 'Entry', 'EndpointAxioms'])
        for args, cwd, env in calls:
            self.assertEqual(cwd, self.root / 'stage')
            self.assertEqual(env['LEAN_PATH'], str(cwd / 'objects') + ':/complete/lake/build')
        self.assertTrue((self.root / 'stage/endpoint-axioms.json').exists())

    def test_smoke_cannot_succeed_without_registered_generated_probe(self):
        self.path.write_text(json.dumps(self.manifest))
        with patch.object(replay_inv48, 'ENDPOINT_ROOTS', {'Entry': []}), \
                patch.object(replay_inv48, 'environment') as environment:
            with self.assertRaisesRegex(ValueError, 'Smoke requires registered Inv08Generated'):
                replay_inv48.replay(self.root, self.root, self.root, self.root / 'stage', False, True)
        environment.assert_not_called()

    def test_binary_mismatch_rejected_before_lake_commands(self):
        (self.root / 'bin').mkdir()
        (self.root / 'bin/lean').write_bytes(b'wrong compiler')
        with patch.object(replay_inv48, 'command') as run:
            with self.assertRaisesRegex(ValueError, 'binary hash mismatch'):
                replay_inv48.environment(self.root, self.root, {'lean_binary_sha256': 'bad'})
        run.assert_not_called()

if __name__ == '__main__':
    unittest.main()
