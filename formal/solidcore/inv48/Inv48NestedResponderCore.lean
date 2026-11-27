import Inv48EscrowEntryRequest
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.NestedResponder
set_option maxRecDepth 65536

/-- A computed observation, including failed Solidity outcomes. -/
structure Observation {α : Type} (tree : SolI α) where
  trace : Interaction.Transcript
  outcome : Except SolidityFailure α
  execution : Interaction.Executes tree trace outcome

/-- Exact same row matching and resource defaults as runWith. No row consumption. -/
def answer (rows : ScriptedResponder) : (q : Query) → Option (Answer q)
  | .external world (.call request) =>
      (rows.answerCall? world request).orElse (fun _ => precompileAnswerCall? world request)
  | .external world (.create request) => rows.answerCreate? world request
  | .resource r => some (Query.defaultAnswer (.resource r))

/-- Bounded, trace-preserving interpreter; budget exhaustion and unmatched rows
are absence, never invented failed-call replies. -/
def observe {α : Type} : Nat → (rows : ScriptedResponder) →
    (tree : SolI α) → Option (Observation tree)
  | 0, _, _ => none
  | _+1, _, .done result => some ⟨[], result, .done result⟩
  | budget+1, rows, .request q k => do
      let a ← answer rows q
      let tail ← observe budget rows (k a)
      pure ⟨⟨q,a⟩ :: tail.trace, tail.outcome, .request a tail.execution⟩

/-- Run the generated ABI dispatcher on the caller's *actual* calldata. The
context is open, and msg.sender is the executing parent's self address. -/
def childTree (fuel : Nat) (c : Context) (state : State) (data : List Byte) :=
  ABI.Contract.callCalldataAtFromWithContext fuel Inv48.Source.model.core
    { c with selfDispatch? := none } state c.self c.self 0 data

/-- No desired child result, trace, success or funding is an argument. -/
def runChild (fuel budget : Nat) (rows : ScriptedResponder)
    (c : Context) (state : State) (data : List Byte) :
    Option ((tree : SolI ABI.AbiCallResult) × Observation tree) := do
  let tree ← childTree fuel c state data
  let observed ← observe budget rows tree
  pure ⟨tree, observed⟩

/-- ABI/function rollback selects the entry state on revert. Failed answers
explicitly retain the parent's original world, including other-account effects. -/
def response (c : Context) (state : State) (result : ABI.AbiCallResult) : CallResponse :=
  { success := result.success
    returnData := bytesToByteArray result.output
    postWorld := if result.success then snapshotWorld c result.state else snapshotWorld c state
    returnedGas := EvmYul.UInt256.ofNat 0 }

theorem rollback (c : Context) (state : State) (result : ABI.AbiCallResult)
    (failed : result.success = false) :
    (response c state result).postWorld = snapshotWorld c state := by
  simp [response, failed]

theorem bodyRollback (f : FunctionDef) (state : State) (r : Runtime) (e : RevertData) :
    f.callBodyResult state (.reverted r e) = .reverted state e.untagFixedBytes := rfl

/-- Nested evidence does not claim that the flat parent transcript contains
child rows. Its child is the computed observation of this very calldata. -/
structure Nested (c : Context) (state : State) (data : List Byte)
    (fuel budget : Nat) (rows : ScriptedResponder) where
  tree : SolI ABI.AbiCallResult
  selected : childTree fuel c state data = some tree
  observed : Observation tree
  computed : observe budget rows tree = some observed

/-- The concrete responder result packages only values obtained by evaluation. -/
structure Served (c : Context) (state : State) (data : List Byte)
    (fuel budget : Nat) (rows : ScriptedResponder) where
  nested : Nested c state data fuel budget rows
  result : ABI.AbiCallResult
  completed : nested.observed.outcome = .ok result

def serve (fuel budget : Nat) (rows : ScriptedResponder)
    (c : Context) (state : State) (data : List Byte) :
    Option (Served c state data fuel budget rows) := do
  match selected : childTree fuel c state data with
  | none => none
  | some tree =>
    match computed : observe budget rows tree with
    | none => none
    | some observed =>
      match completed : observed.outcome with
      | .error _ => none
      | .ok result => some ⟨⟨tree, selected, observed, computed⟩, result, completed⟩

/-- The nested transcript has an explicit call boundary, ordered child events,
then the parent continuation. It never flattens the child into Executes. -/
structure NestedTrace where
  call : Interaction.Transcript
  child : Interaction.Transcript
  continuation : Interaction.Transcript

def servedTrace {c state data fuel budget rows}
    (s : Served c state data fuel budget rows) (rest : Interaction.Transcript) : NestedTrace :=
  { call := [⟨.external (snapshotWorld c state)
      (.call (buildCallRequest c .call c.self data 0 none)), response c state s.result⟩]
    child := s.nested.observed.trace
    continuation := rest }

/-- Attach the actual child observation at the real open request node. The
parent continuation must execute with the *derived* bytes and world. -/
theorem compose {α : Type} (c : Context) (state : State) (data : List Byte)
    (fuel budget : Nat) (rows : ScriptedResponder)
    (nested : Nested c state data fuel budget rows)
    (result : ABI.AbiCallResult) (completed : nested.observed.outcome = .ok result)
    (k : LowLevelCallResult × State → SolI α)
    (rest : Interaction.Transcript) (outcome : Except SolidityFailure α)
    (openWorld : c.selfDispatch? = none)
    (tail : Interaction.Executes
      (k (decodeCallResponse (response c state result) .call c.self data 0 none,
        adoptWorld (response c state result).postWorld c state)) rest outcome) :
    Interaction.Executes nested.tree nested.observed.trace (.ok result) ∧
    Interaction.Executes (selfDispatchCall c state .call c.self data 0 none >>= k)
      (⟨.external (snapshotWorld c state)
        (.call (buildCallRequest c .call c.self data 0 none)), response c state result⟩ :: rest)
      outcome := by
  refine ⟨?_, ?_⟩
  · rw [← completed]; exact nested.observed.execution
  · rw [Inv48.EscrowEntry.openDispatchRequest c state c.self data k openWorld]
    exact .request _ tail
theorem servedComposition {α : Type} (c : Context) (state : State) (data : List Byte)
    (fuel budget : Nat) (rows : ScriptedResponder)
    (s : Served c state data fuel budget rows)
    (k : LowLevelCallResult × State → SolI α)
    (rest : Interaction.Transcript) (outcome : Except SolidityFailure α)
    (openWorld : c.selfDispatch? = none)
    (tail : Interaction.Executes
      (k (decodeCallResponse (response c state s.result) .call c.self data 0 none,
        adoptWorld (response c state s.result).postWorld c state)) rest outcome) :
    Interaction.Executes s.nested.tree (servedTrace s rest).child (.ok s.result) ∧
    Interaction.Executes (selfDispatchCall c state .call c.self data 0 none >>= k)
      ((servedTrace s rest).call ++ (servedTrace s rest).continuation) outcome :=
  compose c state data fuel budget rows s.nested s.result s.completed k rest outcome openWorld tail

end Inv48.NestedResponder
