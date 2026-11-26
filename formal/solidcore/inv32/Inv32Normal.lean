import Inv32CeilHoist
open SolidCore.Solidity.Source
namespace Inv32Normal
def Ends (next : Option Runtime) (prog : SolI Result) : Prop :=
  match next with
  | some r => prog = pure (.normal r)
  | none => ∃ r e, prog = pure (.reverted r e)
theorem block (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (ss : List Stmt) (out : Option Runtime)
    (h : Ends out (Stmt.evalList n t c r.pushScope ss)) :
    Ends (out.map Runtime.popScope) (Stmt.eval (n+1) t c r (.block ss)) := by
  cases out with
  | none => obtain ⟨next,e,ev⟩ := h; exact ⟨next.popScope,e,Inv32Revert.blockRevert _ _ _ _ _ _ _ ev⟩
  | some next => exact Inv32Hoist.block _ _ _ _ _ _ h
theorem step (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (s : Stmt)
    (ss : List Stmt) (out : Option Runtime) (h : Stmt.eval n t c r s = pure (.normal next))
    (done : Ends out (Stmt.evalList n t c next ss)) :
    Ends out (Stmt.evalList n t c r (s::ss)) := by rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ h]; exact done
theorem reject (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (s : Stmt) (ss : List Stmt)
    (h : Ends none (Stmt.eval n t c r s)) : Ends none (Stmt.evalList n t c r (s::ss)) := by
  obtain ⟨nr,e,ev⟩ := h
  exact ⟨nr,e,Inv32Revert.stop _ _ _ _ _ _ _ _ ev⟩
end Inv32Normal
