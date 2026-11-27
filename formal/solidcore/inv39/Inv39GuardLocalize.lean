import Inv39GuardReturn
open SolidCore.Solidity.Source
namespace Inv39.Auth
theorem memLocal (allow : Bool) (w : Watch) (t : FunctionTable) (c : Context) (ty : Ty) (k : String)
    (hidden : w k=false) : guards allow w t c (.memoryLocalize ty k) := by
  intro n r safe _; cases n with
  | zero => rw [Stmt.eval]; exact Fold.reject _ _
  | succ n =>
    rw [Stmt.eval]; dsimp only; cases written:r.localizeMemoryLocal ty k with
    | none => exact Fold.pureValue (Result.reverted r _) _ trivial
    | some q =>
      apply Fold.pureValue (Result.normal q)
      unfold Runtime.localizeMemoryLocal at written
      split at written
      · cases written; exact Relative.refl _ _ _ safe
      · rename_i val _ _
        cases eq:ty.coerceValue? val with
        | none => simp [eq] at written
        | some v =>
          simp only [eq,Option.bind_some,bind,pure,Pure.pure] at written
          let temp := (r.memoryStoredValue v).1
          let ready := (temp.allocMemory (r.memoryStoredValue v).2).1
          have before : Relative w c r ready := sameLocals (.inl (memoryState _ _)) (Init.memoryEnv _ _) safe
          exact before.trans (raw (v:=.memoryRef temp.nextMemory) before.safe hidden (.inr trivial) written)
      · contradiction
end Inv39.Auth
