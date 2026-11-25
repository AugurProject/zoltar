/- Protocol assumption identifiers. The complete premise, equations, scope and
   failure boundary for each constructor are authoritative in
   docs/reference/security-model.html#assumption-aNN. A proof that consumes a
   premise supplies a trace- or deployment-specific interpretation of that ID. -/
namespace Protocol

inductive Assumption where
  | A01 -- Participants act on risk-adjusted economic incentives
  | A02 -- Privately motivated actions cover their costs
  | A03 -- Price discovery and contests attract independent participants
  | A04 -- Participants can mobilize REP to raise an alarm
  | A05 -- Participants value continued access to the supported Statoblast lineage
  | A06 -- At least one executor advances every required public transition
  | A07 -- Truthful-child REP retains enough backing value
  | A08 -- REP market capitalization approximates economic value
  | A09 -- Users value the universes they judge truthful
  | A10 -- Participants can access timely outcome evidence
  | A11 -- Migration is operationally practical
  | A12 -- Bidders will buy enough child REP at the repair auction
  | A13 -- REP is sufficiently liquid
  | A14 -- REP economic value exceeds the open interest it secures
  | A15 -- Question selection remains aligned with user intent
  | A16 -- Deadline transactions can obtain Ethereum inclusion
  | A17 -- OpenOracle has an available, adequately capitalized corrector
  | A18 -- At least one available corrector has an independent net incentive
  | A19 -- A robust reference market makes harmful REP/collateral errors correctable
  | A20 -- Canonical chain data and proof construction remain available
  | A21 -- REP and selected collateral obey the required accounting model
  | A22 -- Participant-controlled recipients can accept required asset deliveries
  | A23 -- Users select verified canonical deployments
  | A24 -- Clients, RPCs, and wallets preserve user intent and canonical state
  | A25 -- Immutable parameters preserve economic and executable security margins
  | A26 -- Ethereum preserves the execution environment the protocol relies on
  | A27 -- Ethereum cryptographic primitives remain secure
  | A28 -- Participants retain control of account authority
  deriving DecidableEq, Repr

/-- Hypothesis for a theorem using exactly the listed external premises.
    Instantiate meaning with the predicates for the world under discussion. -/
def Assumes (meaning : Assumption → Prop) (required : List Assumption) : Prop :=
  ∀ id ∈ required, meaning id

end Protocol
