import Inv48CollateralMinimumCore
open SolidCore.Solidity.Source
namespace Inv48.CollateralMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def hoistInside (r : Runtime) (target : String) (v : Nat) :=
  r.pushScope.declareLocal target (.word v)
def hoistAfter (r : Runtime) (v : Nat) := Inv32OneArg.store r tmp v

theorem hoistRun (n : Nat) (c : Context) (r s next : Runtime) (rows : ScriptedResponder)
    (target key : String) (v : Nat)
    (call : (Stmt.eval (n+1) table c (hoistInside r target 0)
      (.internalCall [target] key [])).runWith rows = .ok (.normal s))
    (old : s.lookupLocal? tmp = some (.word 0))
    (read : s.lookupLocal? target = some (.word v))
    (put : s.assignLocal? tmp (.word v) = some next) :
    (Stmt.eval (n+3) table c r (hoist target key)).runWith rows =
      .ok (.normal next.popScope) := by
  have copy := Inv48.CloneGetters.assign (n+1) table c s next tmp 0 v (.var target) old
    (Inv32Guards.readWord _ _ _ _ _ read) put
  unfold hoist
  change (Stmt.eval (n+3) table c r _).runWith rows = Except.ok ((Result.normal next).mapRuntime Runtime.popScope)
  apply blockRun
  apply seqRun _ _ _ _ _ _ _ _ (congrArg (SolI.runWith rows)
    (Inv48.CloneGetters.decl_none (n+1) table c r.pushScope .uint256 target))
  simp only [Ty.defaultValue]
  change (Stmt.evalList (n+2) table c (hoistInside r target 0) _).runWith rows = _
  apply seqRun _ _ _ _ _ _ _ _ (captureRun _ _ _ _ _ _ _ call)
  apply seqRun _ _ _ _ _ _ _ _ (congrArg (SolI.runWith rows) copy)
  rw [Stmt.evalList]; rfl
end Inv48.CollateralMinimum
