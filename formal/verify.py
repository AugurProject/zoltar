"""Replay the formal proof ledger from any directory.

Install Python 3.9+ and Lean via elan, then run python3 formal/verify.py.
Elan selects formal/lean-toolchain automatically. To check catalogue coverage
without Lean, pass --inventory-only. No packages or network access are needed
once the pinned Lean distribution is installed.

ledger.tsv records each claim's source, proof status, protocol premises and
theorem. A dash on an open row means premises have yet to be assigned. For
grouped entries the entire anchored property remains open. The test-evidence
rows track additional obligations described alongside the regression suites.

INV-32 is a theorem about a manual translation of the two quote functions and
their internal helpers, projecting the amount from each return tuple. The
translation uses the documented full-precision mulDiv and mul512 semantics of
the vendored OpenZeppelin implementation. Source hashes identify the Solidity
and library versions reviewed against the model. Review the correspondence
before updating a hash. Compiler correctness, gas and bytecode equivalence
are outside the theorem. Each later proof should name its protocol premises.
"""

import argparse
import csv
import hashlib
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from tempfile import TemporaryDirectory
from xml.etree.ElementTree import TreeBuilder

FORMAL = Path(__file__).resolve().parent
ROOT = FORMAL.parent
REFERENCE = 'docs/reference/'
SECURITY = REFERENCE + 'security-model.html'
PROTOCOL = REFERENCE + 'invariants.html'
TRADING = REFERENCE + 'trading/invariants.html'


class CatalogueParser(HTMLParser):
    """Read canonical HTML as an element tree, including its HTML void tags."""

    void = set('area base br col embed hr img input link meta param source track wbr'.split())

    def __init__(self):
        super().__init__()
        self.tree = TreeBuilder()

    def handle_starttag(self, tag, attrs):
        self.tree.start(tag, dict(attrs))
        if tag in self.void:
            self.tree.end(tag)

    def handle_startendtag(self, tag, attrs):
        self.tree.start(tag, dict(attrs))
        self.tree.end(tag)

    def handle_endtag(self, tag):
        if tag not in self.void:
            self.tree.end(tag)

    def handle_data(self, data):
        self.tree.data(data)


def document(path):
    parser = CatalogueParser()
    parser.feed((ROOT / path).read_text())
    parser.close()
    return parser.tree.close()


def words(node):
    return ' '.join(''.join(node.itertext()).split())


def catalogue():
    protocol = document(PROTOCOL)
    for item in protocol.findall('.//details[@class="invariant-entry"]'):
        yield (words(item.find('summary/code')), PROTOCOL + '#' + item.get('id'),
               words(item.find('summary/span')))

    for item in protocol.findall('.//section[@id="test-evidence"]/dl/dt'):
        title = words(item)
        yield ('EVIDENCE-' + re.sub(r'[^A-Z0-9]+', '-', title.upper()),
               PROTOCOL + '#test-evidence', title)

    trading = document(TRADING)
    for item in trading.findall('.//dt[@id]'):
        number = int(item.get('id').removeprefix('invariant-'))
        yield (f'INV-{number:02}', TRADING + '#' + item.get('id'), words(item))

    for section in trading.findall('.//section'):
        anchor = section.get('id')
        for index, item in enumerate(section.findall('./ul/li'), 1):
            yield (f'TRADING-{anchor.upper()}-{index}', TRADING + '#' + anchor, words(item))
        if anchor == 'router-custody':
            yield ('TRADING-ROUTER-CUSTODY', TRADING + '#' + anchor, words(section.find('p')))


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def check_inventory():
    assumptions = document(SECURITY).findall('.//li[@id]')
    registry = (FORMAL / 'Axioms.lean').read_text()
    expected = []
    for item in assumptions:
        anchor = item.get('id')
        if anchor.startswith('assumption-'):
            heading = words(item.find('h3'))
            identifier = heading.split()[0]
            require(anchor == 'assumption-' + identifier.lower(), f'Wrong axiom anchor {anchor}')
            expected.append((identifier, heading[len(identifier):].strip()))
    require([i for i, _ in expected] == [f'A{i:02}' for i in range(1, 29)],
            'Review security-model axiom coverage')
    require(re.findall(r'^  \| (A\d+) -- (.+)$', registry, re.M) == expected,
            'Review Axioms.lean against the security model')

    with (FORMAL / 'ledger.tsv').open() as source:
        rows = list(csv.DictReader(source, delimiter='\t'))
    entries = list(catalogue())
    require(len({i for i, _, _ in entries}) == len(entries), 'Duplicate catalogue IDs')
    require(sorted((r['id'], r['source'], r['claim']) for r in rows) == sorted(entries),
            'Review ledger coverage, claim labels and source anchors')
    require({i for i, _, _ in entries if i.startswith('INV-')} ==
            {f'INV-{i:02}' for i in range(1, 63)}, 'Review numbered invariant coverage')
    proved = []
    ids = {i for i, _ in expected}
    for row in rows:
        if row['status'] == 'open':
            require(row['axioms'] == row['theorem'] == '-', f"Unexpected metadata for {row['id']}")
            continue
        require(row['status'] == 'proved-model', f"Unknown status for {row['id']}")
        require(row['axioms'] == 'none' or set(row['axioms'].split(',')) <= ids,
                f"Unknown protocol axiom for {row['id']}")
        require(re.fullmatch(r'[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*', row['theorem']),
                f"Invalid proof declaration for {row['id']}")
        proved.append(row)
    require(any(r['id'] == 'INV-32' and r['theorem'] == 'Inv32.minimumGrossInput'
                and r['axioms'] == 'none' for r in proved), 'Missing INV-32 proof entry')
    print(f'{len(expected)} axioms, {len(rows)} ledger entries, {len(proved)} model proof(s)', flush=True)
    return proved


def source_digest(source):
    path, _, anchor = source.partition('#')
    if not anchor:
        return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
    # Trading entries share comparison conditions with the rest of their section.
    for section in document(path).findall('.//section'):
        definitions = list(section.findall('./dl/*'))
        pairs = list(zip(definitions[::2], definitions[1::2]))
        if any(term.get('id') == anchor for term, _ in pairs):
            text = '\n'.join(words(element) for term, definition in pairs
                             if term.get('id') == anchor or words(term) == 'Comparison conditions'
                             for element in (term, definition))
            return hashlib.sha256(text.encode()).hexdigest()
    raise SystemExit(f'Missing proof statement at {source}')


def check_sources():
    for line in (FORMAL / 'sources.sha256').read_text().splitlines():
        expected, path = line.split(maxsplit=1)
        require(source_digest(path) == expected,
                f'Review INV-32 model correspondence after change to {path}')


def lean(*args):
    try:
        result = subprocess.run(['lean', *args], cwd=FORMAL, text=True, stdout=subprocess.PIPE)
    except FileNotFoundError:
        raise SystemExit('Install the Lean version in formal/lean-toolchain or run --inventory-only')
    if result.returncode:
        sys.stderr.write(result.stdout)
        raise SystemExit(result.returncode)
    return result.stdout


def replay(proofs):
    pinned = (FORMAL / 'lean-toolchain').read_text().strip().split(':v')[1]
    require(lean('--short-version').strip() == pinned, f'Install Lean {pinned}')
    flags = ['--trust=0', '-DwarningAsError=true']
    lean(*flags, 'Axioms.lean')
    with TemporaryDirectory() as directory:
        audit = Path(directory) / 'Audit.lean'
        for proof in proofs:
            theorem = proof['theorem']
            model = FORMAL / (theorem.split('.')[0] + '.lean')
            audit.write_text(model.read_text() + f'\n#print axioms {theorem}\n')
            output = lean(*flags, str(audit))
            foundations = {'propext', 'Quot.sound', 'Classical.choice'}
            match = re.fullmatch(rf"'{re.escape(theorem)}' depends on axioms: \[(.*?)\]\s*", output)
            independent = f"'{theorem}' does not depend on any axioms"
            require(output.strip() == independent or
                    (match and set(match[1].split(', ')) <= foundations),
                    'Unexpected proof dependencies: ' + output)
            print(output.strip())



if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cli.add_argument('--inventory-only', action='store_true')
    args = cli.parse_args()
    proofs = check_inventory()
    check_sources()
    if not args.inventory_only:
        replay(proofs)
