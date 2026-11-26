"""Regression checks for the source-closure boundary; no Lean toolchain required."""

import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import replay_inv39


class ClosureTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory(prefix='inv39-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.models = self.root / 'models'
        self.models.mkdir()
        self.work = self.root / 'work'
        self.work.mkdir()
        (self.root / 'Entry.lean').write_text('import InvFixtureGenerated\n')
        (self.models / 'Model.lean').write_text('-- freshly generated fixture\n')
        self.manifest = self.root / 'sources.json'
        self.rows = [
            dict(module='Entry', path='Entry.lean', model_relative_path=None,
                 imports=['InvFixtureGenerated']),
            dict(module='InvFixtureGenerated', path=None, model_relative_path='Model.lean', imports=[]),
        ]
        for row in self.rows:
            source = (self.models / row['model_relative_path'] if row['model_relative_path']
                      else self.root / row['path'])
            row['sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
        self.write_manifest()
        for name, value in [('REPO', self.root), ('MANIFEST', self.manifest)]:
            patcher = patch.object(replay_inv39, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def write_manifest(self):
        self.manifest.write_text(json.dumps(dict(
            entries=['Entry'], modules=self.rows, topological_order=['InvFixtureGenerated', 'Entry'],
        )))

    def test_exact_sources_stage_dependency_first(self):
        self.assertEqual(replay_inv39.stage(self.models, self.work), ['InvFixtureGenerated', 'Entry'])
        self.assertEqual((self.work / 'Entry.lean').read_bytes(), (self.root / 'Entry.lean').read_bytes())

    def test_repository_import_without_inv_prefix_cannot_be_omitted(self):
        helper = self.root / 'formal/solidcore/inv32/CheckedWordCall.lean'
        helper.parent.mkdir(parents=True)
        helper.write_text('-- checked helper\n')
        entry = self.root / 'Entry.lean'
        entry.write_text('import InvFixtureGenerated\nimport CheckedWordCall\n')
        self.rows[0]['sha256'] = hashlib.sha256(entry.read_bytes()).hexdigest()
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'CheckedWordCall'):
            replay_inv39.stage(self.models, self.work)

    def test_changed_proof_or_regenerated_model_is_rejected(self):
        for source in [self.root / 'Entry.lean', self.models / 'Model.lean']:
            with self.subTest(source=source.name):
                original = source.read_bytes()
                source.write_bytes(original + b'-- changed\n')
                with self.assertRaisesRegex(ValueError, 'source hash/import mismatch'):
                    replay_inv39.stage(self.models, self.work)
                source.write_bytes(original)

    def test_missing_model_is_rejected(self):
        (self.models / 'Model.lean').unlink()
        with self.assertRaises(FileNotFoundError):
            replay_inv39.stage(self.models, self.work)

    def test_unneeded_module_is_rejected(self):
        self.rows.append(dict(self.rows[1], module='InvUnused'))
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'Unneeded modules'):
            replay_inv39.stage(self.models, self.work)

    def test_nonportable_path_is_rejected(self):
        self.rows[0]['path'] = '../Entry.lean'
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'Nonportable source path'):
            replay_inv39.stage(self.models, self.work)


if __name__ == '__main__':
    unittest.main()
