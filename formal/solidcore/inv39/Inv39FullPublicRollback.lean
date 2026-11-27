import Inv39InstalledMarker
import Inv39MovementMarkerLocalHistory
import Inv39MarkerHistoryReads
import Inv39Coverage
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.FullPublic

theorem bodyRollback (f : FunctionDef) (s post : State) (res : Result) (err : RevertData)
    (eq : f.callBodyResult s res=.reverted post err) : post=s := by
  cases res <;> simp only [FunctionDef.callBodyResult] at eq
  all_goals repeat' first | split at eq | contradiction | (cases eq; rfl)

theorem revertedState (fuel : Nat) (s post : State) (c : Context) (name : String)
    (args : List Source.Value) (err : RevertData)
    (actual : TypeCheck.CheckedContract.callTargetWithContext? fuel model (.name name) c s args=
      some (.reverted post err)) : post=s := by
  unfold TypeCheck.CheckedContract.callTargetWithContext? at actual
  split at actual
  · rename_i f found
    change f.call? fuel model.core.table c s args=_ at actual
    unfold FunctionDef.call? FunctionDef.call at actual
    cases entry : f.evalBodyEntry fuel model.core.table c s args with
    | none => simp [entry] at actual
    | some tree =>
      simp only [entry,Option.map_some,Option.bind_some] at actual
      have liftBody := Fold.bindRun [] tree (fun v => pure (f.callBodyResult s v))
      change SolI.runWith [] (Functor.map (f.callBodyResult s) tree)=_ at liftBody
      cases ev : tree.runWith [] with
      | error e => simp [liftBody,ev,Bind.bind,Except.bind] at actual
      | ok res =>
        have eq : f.callBodyResult s res=.reverted post err := by
          simpa [liftBody,ev,Bind.bind,Except.bind,SolI.runWith,Pure.pure,EvmCompiler.Simulation.Interaction.pure] using actual
        exact bodyRollback _ _ _ _ _ eq
  · contradiction
#print axioms revertedState
end Inv39.FullPublic
