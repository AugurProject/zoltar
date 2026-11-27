import Inv48ChildExtractionSelection
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.EscrowPrefix
namespace Inv48.ChildExtraction
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- A pure terminal adapter cannot add or remove transcript events. -/
theorem terminal {α β : Type} (tree : SolI α)
    (f : α → Except SolidityFailure β) (trace : Interaction.Transcript) (y : β)
    (run : Interaction.Executes (tree >>= fun x => .done (f x)) trace (.ok y)) :
    ∃ x, Interaction.Executes tree trace (.ok x) ∧ f x = .ok y := by
  induction tree generalizing trace with
  | done out =>
    cases out with
    | error err => cases run
    | ok x =>
      change Interaction.Executes (.done (f x)) trace (.ok y) at run
      cases fx : f x with
      | error err => rw [fx] at run; cases run
      | ok z => rw [fx] at run; cases run; exact ⟨x,.done _,fx⟩
  | request q next ih =>
    cases run with
    | request answer tail =>
      obtain ⟨x, exec, eq⟩ := ih answer _ tail
      exact ⟨x, .request answer exec, eq⟩

/-- Keep collection and ABI output encoding explicit, including their failures. -/
def finish (contract : Contract) (fn : FunctionDef) (state : State) (r : Result) :
    Except SolidityFailure ABI.AbiCallResult :=
  match ABI.Contract.encodeCalldataResult? contract fn (fn.callBodyResult state r) with
  | some result => .ok result
  | none => .error .outOfFuel

theorem adapter (contract : Contract) (fn : FunctionDef) (state : State) (tree : SolI Result) :
    ((Functor.map (fn.callBodyResult state) tree : SolI CallResult) >>=
      fun cr => ABI.liftAbiEncode (ABI.Contract.encodeCalldataResult? contract fn cr)) =
    (tree >>= fun r => .done (finish contract fn state r)) := by
  induction tree with
  | done out =>
    cases out with
    | error err => rfl
    | ok r =>
      change ABI.liftAbiEncode (ABI.Contract.encodeCalldataResult? contract fn (fn.callBodyResult state r)) =
        .done (finish contract fn state r)
      cases enc : ABI.Contract.encodeCalldataResult? contract fn (fn.callBodyResult state r) with
      | none => simp [ABI.liftAbiEncode,finish,enc]
      | some result =>
        simp only [ABI.liftAbiEncode,finish,enc]
        rfl
  | request q next ih =>
    change Interaction.request q _ = Interaction.request q _
    congr 1
    funext a
    exact ih a

/-- Exact ABI decode is an explicit canonical-input requirement, not an
assumption that encoding arbitrary Nats preserves their values. -/
structure Canonical (data : List Byte) (args : List Value) : Prop where
  selector : ABI.readSelector? data = some 2391489481
  decoded : ABI.decodeFunctionArgs? Inv48.EscrowEntry.fn
    (data.drop ABI.selectorBytes) = .ok args

theorem dispatch (fuel : Nat) (c : Context) (state : State)
    (data : List Byte) (args : List Value) (canonical : Canonical data args) :
    Inv48.NestedResponder.childTree fuel c state data =
      (Inv48.EscrowEntry.fn.evalBodyEntry fuel Inv48.Source.model.core.table
        (Inv48.PublicInvariant.childContext c data) state args).map
        (fun tree => tree >>= fun r => .done (finish Inv48.Source.model.core
          Inv48.EscrowEntry.fn state r)) := by
  unfold Inv48.NestedResponder.childTree ABI.Contract.callCalldataAtFromWithContext
  simp only [canonical.selector, selected, canonical.decoded]
  have accepts : Inv48.EscrowEntry.fn.acceptsValue 0 = true := by
    simp [FunctionDef.acceptsValue, Inv48.EscrowEntry.metadata.2.2, wordEq]
  simp only [accepts, if_true]
  unfold FunctionDef.call
  change Option.map _ (Option.map _
    (Inv48.EscrowEntry.fn.evalBodyEntry fuel Inv48.Source.model.core.table
      (Inv48.PublicInvariant.childContext c data) state args)) = _
  cases entry : Inv48.EscrowEntry.fn.evalBodyEntry fuel Inv48.Source.model.core.table
    (Inv48.PublicInvariant.childContext c data) state args with
  | none => rfl
  | some tree => exact congrArg some (adapter _ _ _ tree)

/-- Extraction uses precisely the computed observation's transcript. -/
theorem body (fuel budget : Nat) (rows : ScriptedResponder) (c : Context) (state : State)
    (data : List Byte) (args : List Value) (canonical : Canonical data args)
    (served : Inv48.NestedResponder.Served c state data fuel budget rows) :
    ∃ tree r,
      Inv48.EscrowEntry.fn.evalBodyEntry fuel Inv48.Source.model.core.table
        (Inv48.PublicInvariant.childContext c data) state args = some tree ∧
      ExecutesOK tree served.nested.observed.trace r ∧
      finish Inv48.Source.model.core Inv48.EscrowEntry.fn state r = .ok served.result := by
  have selection := served.nested.selected
  rw [dispatch fuel c state data args canonical] at selection
  cases entry : Inv48.EscrowEntry.fn.evalBodyEntry fuel Inv48.Source.model.core.table
    (Inv48.PublicInvariant.childContext c data) state args with
  | none => simp [entry] at selection
  | some tree =>
    simp only [entry, Option.map_some, Option.some.injEq] at selection
    have run := served.nested.observed.execution
    rw [served.completed] at run
    have adapted := Eq.mpr (congrArg (fun t => Interaction.Executes t
      served.nested.observed.trace (.ok served.result)) selection) run
    obtain ⟨r, exec, done⟩ := terminal tree _ _ _ adapted
    exact ⟨tree,r,rfl,exec,done⟩

#print axioms selected
#print axioms body
end Inv48.ChildExtraction
