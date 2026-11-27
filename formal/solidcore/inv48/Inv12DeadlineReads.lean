import Inv12DeadlineFound
import Inv12RecordEval
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12.Deadline

theorem sourceCastRead (c : Context) (r : Runtime) (source : Nat) (hi : source<2^248)
    (lookup : r.lookupLocal? "source"=some (.word source)) :
    Inv40.Reads c r (.castOp .uintCast 248 (.var "source")) source := by
  have fit : source<Inv32Division.R := lt_trans hi (by decide)
  have cast : uintCast? 248 (.word source)=.ok (.word source) := by
    norm_num at hi
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,
      show Shared.norm source=source from Nat.mod_eq_of_lt fit,Nat.mod_eq_of_lt hi,Bind.bind,Except.bind]
  intro fuel enough
  change 2≤fuel at enough
  obtain ⟨k,rfl⟩ := Nat.exists_eq_add_of_le' enough
  rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ lookup]
  change (do let v ← liftM (uintCast? 248 (.word source));pure (v,r) : SolI (Value × Runtime))=_
  rw [cast];rfl

theorem conditionRead (c : Context) (r : Runtime) (deadline : Nat)
    (fit : deadline<Inv32Division.R)
    (look : r.lookupLocal? "#view55674"=some (.word deadline)) :
    Expr.eval c r (.binary .lt (.castOp .uintCleanup 256 (.env .blockTimestamp))
      (.castOp .uintCleanup 256 (.var "#view55674")))=
      pure (.word (Shared.ltWord (EnvWord.eval .blockTimestamp c) deadline),r) := by
  have lhs : Expr.evalFuel 5 c r (.castOp .uintCleanup 256 (.env .blockTimestamp))=
      pure (.word (EnvWord.eval .blockTimestamp c),r) := by
    apply Inv32Guards.clean _ _ _ _ _ (show EnvWord.eval .blockTimestamp c<Inv32Division.R from Nat.mod_lt _ (by decide))
    rw [Expr.evalFuel] <;> first | rfl | (intro h;cases h)
  have rhs : Expr.evalFuel 5 c r (.castOp .uintCleanup 256 (.var "#view55674"))=
      pure (.word deadline,r) := Inv32Guards.clean _ _ _ _ _ fit (Inv32Guards.readWord _ _ _ _ _ look)
  unfold Expr.eval
  apply Inv32Eval.binary _ _ _ _ (by intro h;cases h) (by intro h;cases h) _ _ _ _ _ lhs rhs
  rfl
#print axioms sourceCastRead
#print axioms conditionRead
end Inv12.Deadline
