import Inv48CollateralMinimumAggregate
import Inv48CollateralReadDecodedCore
import Inv48QuoteQueryClassCore
open SolidCore.Solidity.Source
namespace Inv48.QuoteSegmentEvents
open Inv48.CollateralMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem seqTree (n : Nat) (c : Context) (r s : Runtime)
    (a : Stmt) (rest : List Stmt) (out : Result)
    (first : Stmt.eval n table c r a = pure (.normal s))
    (last : Stmt.evalList n table c s rest = pure out) :
    Stmt.evalList n table c r (a::rest) = pure out := by
  rw [Stmt.evalList,first]
  exact last

theorem blockTree (n : Nat) (c : Context) (r : Runtime)
    (ss : List Stmt) (out : Result)
    (body : Stmt.evalList n table c r.pushScope ss = pure out) :
    Stmt.eval (n+1) table c r (.block ss) = pure (out.mapRuntime Runtime.popScope) := by
  rw [Stmt.eval]
  change (Stmt.evalList n table c r.pushScope ss >>= _) = _
  rw [body]
  rfl

theorem captureTree (n : Nat) (c : Context) (r s : Runtime)
    (target key : String)
    (call : Stmt.eval n table c r (.internalCall [target] key []) = pure (.normal s)) :
    Stmt.eval (n+1) table c r (.captureReturn [target] (.internalCall [target] key [])) = pure (.normal s) := by
  rw [Stmt.eval]
  change (Stmt.eval n table c r (.internalCall [target] key []) >>= _) = _
  rw [call]
  rfl

def hoistInside (r : Runtime) (target : String) (v : Nat) :=
  r.pushScope.declareLocal target (.word v)
def hoistAfter (r : Runtime) (v : Nat) := Inv32OneArg.store r tmp v

theorem hoistRun (n : Nat) (c : Context) (r s next : Runtime)
    (target key : String) (v : Nat)
    (call : (Stmt.eval (n+1) table c (hoistInside r target 0)
      (.internalCall [target] key [])) = pure (.normal s))
    (old : s.lookupLocal? tmp = some (.word 0))
    (read : s.lookupLocal? target = some (.word v))
    (put : s.assignLocal? tmp (.word v) = some next) :
    (Stmt.eval (n+3) table c r (hoist target key)) =
      pure (.normal next.popScope) := by
  have copy := Inv48.CloneGetters.assign (n+1) table c s next tmp 0 v (.var target) old
    (Inv32Guards.readWord _ _ _ _ _ read) put
  unfold hoist
  change (Stmt.eval (n+3) table c r _) = pure ((Result.normal next).mapRuntime Runtime.popScope)
  apply blockTree
  apply seqTree _ _ _ _ _ _ _ (Inv48.CloneGetters.decl_none (n+1) table c r.pushScope .uint256 target)
  simp only [Ty.defaultValue]
  change (Stmt.evalList (n+2) table c (hoistInside r target 0) _) = _
  apply seqTree _ _ _ _ _ _ _ (captureTree _ _ _ _ _ _ call)
  apply seqTree _ _ _ _ _ _ _ copy
  rw [Stmt.evalList]
end Inv48.QuoteSegmentEvents
