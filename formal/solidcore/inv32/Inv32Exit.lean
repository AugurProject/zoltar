import Inv32CeilAdd
open SolidCore.Solidity.Source
namespace Inv32Exit
def Terminates (initial : Runtime) (values : Option (List Value)) (program : SolI Result) : Prop :=
  match values with
  | none => ∃ next err, program = pure (.reverted next err)
  | some vs => ∃ next, Inv32WidePath.sameEffects next initial ∧ program = pure (.returned next vs)
def words (ns : Option Nat) : Option (List Value) := ns.map (fun n => [.word n])
theorem block (n : Nat) (t : FunctionTable) (c : Context) (initial r : Runtime) (ss : List Stmt)
    (v : Option (List Value)) (h : Terminates initial v (Stmt.evalList n t c r.pushScope ss)) :
    Terminates initial v (Stmt.eval (n+1) t c r (.block ss)) := by
  cases v with
  | none => obtain ⟨next,e,ev⟩ := h; exact ⟨next.popScope,e,Inv32Revert.blockRevert _ _ _ _ _ _ _ ev⟩
  | some vs =>
    obtain ⟨next,effect,ev⟩ := h
    exact ⟨next.popScope,fun ls => effect ls,Inv32FloorFastPath.blockReturned _ _ _ _ _ _ _ ev⟩
theorem stop (n : Nat) (t : FunctionTable) (c : Context) (initial r : Runtime) (s : Stmt) (ss : List Stmt)
    (v : Option (List Value)) (h : Terminates initial v (Stmt.eval n t c r s)) :
    Terminates initial v (Stmt.evalList n t c r (s::ss)) := by
  cases v with
  | none => obtain ⟨next,e,ev⟩ := h; exact ⟨next,e,Inv32Revert.stop _ _ _ _ _ _ _ _ ev⟩
  | some vs => obtain ⟨next,effect,ev⟩ := h; exact ⟨next,effect,Inv32FloorFastPath.stop _ _ _ _ _ _ _ _ ev⟩
theorem pass (n : Nat) (t : FunctionTable) (c : Context) (initial r next : Runtime)
    (s : Stmt) (ss : List Stmt) (v : Option (List Value)) (h : Stmt.eval n t c r s = pure (.normal next))
    (done : Terminates initial v (Stmt.evalList n t c next ss)) :
    Terminates initial v (Stmt.evalList n t c r (s::ss)) := by rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ h]; exact done
end Inv32Exit
