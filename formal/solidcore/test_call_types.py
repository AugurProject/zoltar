"""Focused solc-resolved literal projection regressions (no Lean required)."""

import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

from call_types import nodes, preserve_numeric_call_types

SOURCE = '''pragma solidity ^0.8.28;
interface Clock {
 function securityPoolTimeForNative(uint248 a, uint48 b) external;
 function overloaded(uint48 a) external;
 function overloaded(uint96 a) external;
}
contract Consumer {
 function run(Clock c) external {
  c.securityPoolTimeForNative(1, 0);
  c.overloaded(uint96(0));
 }
}
'''


class CallTypesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = os.environ.get('SOLC', shutil.which('solc'))
        if not compiler:
            raise RuntimeError('Set SOLC to solc 0.8.28 or newer')
        request = dict(language='Solidity', sources={'Fixture.sol': {'content': SOURCE}},
                       settings={'outputSelection': {'*': {'': ['ast'], '*': ['evm.methodIdentifiers']}}})
        data = json.loads(subprocess.check_output(
            [compiler, '--standard-json'], input=json.dumps(request), text=True))
        errors = [e for e in data.get('errors', []) if e['severity'] == 'error']
        if errors:
            raise ValueError(errors)
        cls.ast = data['sources']['Fixture.sol']['ast']
        cls.methods = data['contracts']['Fixture.sol']['Clock']['evm']['methodIdentifiers']

    def test_resolved_literals_and_original_preservation(self):
        before = copy.deepcopy(self.ast)
        fixed, changes = preserve_numeric_call_types(self.ast)
        self.assertEqual(self.ast, before)
        self.assertEqual([(c['type'], c['literal']) for c in changes], [('uint248', '1'), ('uint48', '0')])
        call = next(n for n in nodes(fixed) if n.get('nodeType') == 'FunctionCall'
                    and n.get('expression', {}).get('memberName') == 'securityPoolTimeForNative')
        original = next(n for n in nodes(before) if n.get('id') == call['id'])
        declaration = next(n for n in nodes(before)
                           if n.get('id') == call['expression']['referencedDeclaration'])
        for argument, literal, parameter in zip(
            call['arguments'], original['arguments'], declaration['parameters']['parameters']
        ):
            self.assertEqual(argument['kind'], 'typeConversion')
            self.assertEqual(argument['expression']['typeName'], parameter['typeName'])
            self.assertEqual(argument['arguments'], [literal])
        self.assertEqual(self.methods['securityPoolTimeForNative(uint248,uint48)'], '2f88e645')
        self.assertEqual(declaration['functionSelector'],
                         self.methods['securityPoolTimeForNative(uint248,uint48)'])
        self.assertEqual(preserve_numeric_call_types(fixed), (fixed, []))

    def test_literal_spelling_and_unsupported_forms(self):
        for value, unit, converted in [('0xff', None, True), ('1e2', None, False),
                                        ('1.5', None, False), ('1', 'days', False)]:
            with self.subTest(value=value, unit=unit):
                ast = copy.deepcopy(self.ast)
                call = next(n for n in nodes(ast) if n.get('nodeType') == 'FunctionCall'
                            and n.get('expression', {}).get('memberName') == 'securityPoolTimeForNative')
                call['arguments'][1]['value'] = value
                call['arguments'][1]['subdenomination'] = unit
                fixed, changes = preserve_numeric_call_types(ast)
                self.assertEqual(len(changes), 2 if converted else 1)
                if converted:
                    argument = next(n for n in nodes(fixed) if n.get('nodeType') == 'FunctionCall'
                                    and n.get('expression', {}).get('memberName') == 'securityPoolTimeForNative')['arguments'][1]
                    self.assertEqual(argument['arguments'][0], call['arguments'][1])

    def test_resolved_overload_uses_declaration_id(self):
        ast = copy.deepcopy(self.ast)
        call = next(n for n in nodes(ast) if n.get('nodeType') == 'FunctionCall'
                    and n.get('expression', {}).get('memberName') == 'overloaded')
        # Solc has already selected uint96; removing its explicit cast simulates
        # the literal-to-parameter boundary without guessing from the name.
        call['arguments'][0] = call['arguments'][0]['arguments'][0]
        _, changes = preserve_numeric_call_types(ast)
        self.assertEqual(changes[-1]['type'], 'uint96')
        declaration = next(n for n in nodes(ast)
                           if n.get('id') == changes[-1]['declarationId'])
        self.assertEqual(declaration['functionSelector'], self.methods['overloaded(uint96)'])
        self.assertIn('overloaded(uint96)', self.methods)
        self.assertIn('overloaded(uint48)', self.methods)

    def test_unresolved_is_not_guessed(self):
        ast = copy.deepcopy(self.ast)
        for node in nodes(ast):
            if node.get('nodeType') == 'MemberAccess':
                node.pop('referencedDeclaration', None)
        self.assertEqual(preserve_numeric_call_types(ast), (ast, []))

    def test_named_and_options_wrapped_calls_are_unchanged(self):
        for form in ['named', 'options']:
            with self.subTest(form=form):
                ast = copy.deepcopy(self.ast)
                call = next(n for n in nodes(ast) if n.get('nodeType') == 'FunctionCall'
                            and n.get('expression', {}).get('memberName') == 'securityPoolTimeForNative')
                if form == 'named':
                    call['names'] = ['a', 'b']
                else:
                    call['expression'] = {'nodeType': 'FunctionCallOptions',
                                          'expression': call['expression'], 'names': [], 'options': []}
                self.assertEqual(preserve_numeric_call_types(ast), (ast, []))

    def test_resolved_arity_mismatch_rejected(self):
        ast = copy.deepcopy(self.ast)
        call = next(n for n in nodes(ast) if n.get('nodeType') == 'FunctionCall'
                    and n.get('expression', {}).get('memberName') == 'securityPoolTimeForNative')
        call['arguments'].pop()
        with self.assertRaisesRegex(ValueError, 'arity mismatch'):
            preserve_numeric_call_types(ast)

    def test_out_of_range_rejected(self):
        ast = copy.deepcopy(self.ast)
        for node in nodes(ast):
            if node.get('nodeType') == 'Literal' and node.get('value') == '0':
                node['value'] = str(2**248)
        with self.assertRaisesRegex(ValueError, 'outside resolved'):
            preserve_numeric_call_types(ast)


class LoweringTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('SOLIDCORE_ROOT'), 'Set SOLIDCORE_ROOT for the Lean lowering regression')
    def test_explicit_cast_lowering_and_selector(self):
        root = Path(os.environ['SOLIDCORE_ROOT']).resolve()
        lean_path = subprocess.check_output(
            ['lake', 'env', 'printenv', 'LEAN_PATH'], cwd=root, text=True).strip()
        subprocess.run(['lean', str(Path(__file__).parent.resolve() / 'tests/CallTypes.lean')],
                       cwd=root, env={**os.environ, 'LEAN_PATH': lean_path}, check=True)


if __name__ == '__main__':
    unittest.main()
