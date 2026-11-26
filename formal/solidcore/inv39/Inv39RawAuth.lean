import Inv39RawAuthShape
import Inv39Public
open SolidCore.Solidity SolidCore.Solidity.Source Inv32FloorStart
namespace Inv39.Auth
def ptr : Source.Value := .storageSlotRef position layout
def empty : Source.Value := .storageRef emptyRef
def parms (r : Runtime) (v : Source.Value) := r.withFrame [(target,v)]
theorem run (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) :
    Stmt.eval (n+3) t c (parms r empty) shape=pure (.normal (parms r ptr)) := by
  let outer := (parms r empty).pushScope
  let localPos := (outer.pushScope.declareLocal "location" (.fixedBytes 32 position))
  let updated := ((parms r ptr).pushScope.pushScope.declareLocal "location" (.fixedBytes 32 position))
  have decl : Stmt.eval (n+1) t c outer.pushScope (.varDecl (.fixedBytes 32) "location" (some (.word position)))=pure (.normal localPos) := by
    rw [Stmt.eval]; rfl
  have loc : (Source.Expr.var "location").eval c localPos=pure (.fixedBytes 32 position,localPos) := by rfl
  have put : Stmt.eval (n+1) t c localPos (.bindRawSlot target layout (.var "location"))=pure (.normal updated) := by
    rw [Stmt.eval]; dsimp only; rw [loc]; rfl
  have blk := Inv32Hoist.block (n+1) t c outer updated _ ((seqStep _ _ _ _ _ _ _ decl).trans
    ((seqStep _ _ _ _ _ _ [] put).trans (show Stmt.evalList (n+1) t c updated []=pure (.normal updated) by rw [Stmt.evalList])))
  have sk : Stmt.eval (n+2) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  exact Inv32Hoist.block (n+2) t c (parms r empty) updated.popScope _ ((seqStep _ _ _ _ _ _ _ sk).trans
    ((seqStep _ _ _ _ _ _ [] blk).trans (show Stmt.evalList (n+2) t c updated.popScope []=pure (.normal updated.popScope) by rw [Stmt.evalList])))
theorem call (n : Nat) (c : Context) (r : Runtime) (names : List String) :
    Stmt.eval (n+4) model.core.table c r (.internalCall names helper [])=internalCallAssign r names [ptr] := by
  obtain ⟨f,link,ps,rs,bd⟩ := linked
  let bare := {r with locals:=[]}
  have enter : internalCallEnter? f [] r=some (parms bare empty,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,parms,bare,empty,emptyRef,uninitializedStorageReturnTarget,Runtime.withFrame]
  have body := run n model.core.table {c with checked:=true} bare
  rw [←bd] at body
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (by rfl) link enter body]
  simp [internalCallFinish,rs,collectReturnBindingsRef,collectReturnBindingsRef.collect,parms,ptr,target,Runtime.lookupLocal?,LocalEnv.lookup?,
    Frame.lookup?,Runtime.withFrame,bare,Bind.bind,Except.bind]
end Inv39.Auth
