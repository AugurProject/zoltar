"""Preserve solc-resolved unsigned literal types before SolidCore lowering.

This copies the projected AST; original Solidity and prior proof inputs remain
unchanged. Unsupported conversions are left to the checked importer. Declaration
IDs, never names, select overloads. Synthetic casts have no solc declaration IDs.
"""

import copy
import re


def nodes(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from nodes(child)


def preserve_numeric_call_types(ast):
    """Materialize solc-resolved unsigned literal conversions before lowering.

    Only resolved external member calls, positional args, elementary uintN and
    in-range integer literals are covered. No name-based overload guessing.
    Input must be a successfully solc-typechecked AST. Leave other forms intact.
    """
    result = copy.deepcopy(ast)
    declarations = {n['id']: n for n in nodes(result) if 'id' in n}
    changes = []
    for call in list(nodes(result)):
        if call.get('nodeType') != 'FunctionCall' or call.get('names'):
            continue
        member = call.get('expression', {})
        if member.get('nodeType') != 'MemberAccess':
            continue
        function_type = member.get('typeDescriptions', {}).get('typeString', '')
        if 'external' not in function_type.split():
            continue
        decl = declarations.get(member.get('referencedDeclaration'), {})
        if decl.get('nodeType') != 'FunctionDefinition':
            continue
        params = decl.get('parameters', {}).get('parameters', [])
        args = call.get('arguments', [])
        if len(params) != len(args):
            raise ValueError('resolved call arity mismatch')
        for i, (param, arg) in enumerate(zip(params, args)):
            ty = param.get('typeName', {})
            match = re.fullmatch(r'uint([0-9]+)', ty.get('name', ''))
            if (
                ty.get('nodeType') != 'ElementaryTypeName' or not match
                or int(match[1]) not in range(8, 257, 8)
                or arg.get('nodeType') != 'Literal'
                or arg.get('kind') != 'number' or arg.get('subdenomination')
            ):
                continue
            value = arg.get('value', '')
            if not re.fullmatch(r'(0x[0-9a-fA-F]+|[0-9]+)', value):
                continue
            number = int(value, 16 if value.startswith('0x') else 10)
            if number >= 2 ** int(match[1]):
                raise ValueError('literal outside resolved unsigned parameter range')
            if match[1] == '256':
                continue
            args[i] = {
                'nodeType': 'FunctionCall', 'kind': 'typeConversion', 'names': [],
                'expression': {
                    'nodeType': 'ElementaryTypeNameExpression',
                    'typeName': copy.deepcopy(ty),
                },
                'arguments': [arg],
            }
            changes.append({
                'callId': call.get('id'), 'declarationId': decl['id'],
                'member': member.get('memberName'), 'argument': i,
                'type': ty['name'], 'literal': value,
            })
    return result, changes
