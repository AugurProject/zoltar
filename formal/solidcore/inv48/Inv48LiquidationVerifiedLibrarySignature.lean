import Inv48LiquidationVerifiedObserved
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationBody
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def signatureCheck : Bool := match t.lookup? GuardRecovery.executionLibraryKey with
  | none => false
  | some fn => decide (Inv32Internal.decode fn.params = some ["price","uncertainty"]) &&
      match Inv32Internal.decode fn.returns with
      | some [_] => true
      | _ => false

theorem signatureChecked : signatureCheck = true := by native_decide

theorem signature (fn : InternalFunction)
    (found : t.lookup? GuardRecovery.executionLibraryKey = some fn) :
    fn.params = Inv32Internal.wordBindings ["price","uncertainty"] ∧
    (∃ name, fn.returns = Inv32Internal.wordBindings [name]) ∧
    fn.body = actualLiquidationLibraryBody := by
  have checked := signatureChecked
  simp only [signatureCheck,found,Bool.and_eq_true,decide_eq_true_eq] at checked
  refine ⟨Inv32Internal.wordBindingsOf _ _ checked.1,?_,?_⟩
  · cases ds : Inv32Internal.decode fn.returns with
    | none => simp [ds] at checked
    | some ns =>
      cases ns with
      | nil => simp [ds] at checked
      | cons n ns =>
        cases ns with
        | cons a ns => simp [ds] at checked
        | nil => exact ⟨n,Inv32Internal.wordBindingsOf _ _ ds⟩
  · have body := GuardRecovery.checked_library_body
    change (t.lookup? GuardRecovery.executionLibraryKey).map InternalFunction.body = _ at body
    rw [found] at body
    exact Option.some.inj body

#print axioms signature
end LiquidationBody
