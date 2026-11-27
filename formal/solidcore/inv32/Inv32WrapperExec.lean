import Inv32Wrapper
open SolidCore.Solidity.Source Inv32Dispatch Inv32Division Inv32Wrapper Inv32Exit Inv32FloorStart Inv32FloorFastPath
namespace Inv32WrapperExec
macro "write_entry" : tactic => `(tactic|
  simp [top,frame,input,output,work,result,method,targets,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
    Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.pushScope,Runtime.withFrame,LocalEnv.assign?,LocalEnv.lookup?,
    Frame.assign?,Frame.lookup?,Value.coerceLike?])
theorem innerRun (n : Nat) (c : Context) (r : Runtime) (d : Direction) (x y a f : Nat) (o : Option (Nat × Nat))
    (hx : x<R) (hy : y<R) (ha : a<R) (hf : f<R)
    (called : Binds (work r d x y a f 0 0) d o (Stmt.eval (n+1) model.core.table c (work r d x y a f 0 0) (callStmt d))) :
    Terminates r (toValues o) (Stmt.eval (n+3) model.core.table c (top r d x y a f).pushScope.pushScope (inner d)) := by
  let t := model.core.table
  let pre := work r d x y a f 0 0
  have ready := setup (n+1) t c r d x y a f hx hy ha hf [.captureReturn (targets d) (callStmt d),ret d]
  apply Inv32Exit.block
  rw [ready]
  cases o with
  | none =>
    obtain ⟨s,e,ev⟩ := called
    exact Inv32Exit.stop _ _ _ _ _ _ _ _ (show Terminates r none _ from ⟨s,e,Inv32Revert.capture _ _ _ _ _ _ _ _ ev⟩)
  | some vals =>
    obtain ⟨q,fee⟩ := vals
    let next := work r d x y a f q fee
    have write : pre.assignNamedValuesRef? (targets d) [.word q,.word fee] = some next := by
      have distinct : result d 1 ≠ result d 0 := by cases d <;> decide
      simp [pre,next,work,targets,Runtime.withFrame,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
        Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.assign?,LocalEnv.lookup?,Frame.assign?,Frame.lookup?,
        Value.coerceLike?,distinct]
    have assigned : internalCallAssign pre (targets d) [.word q,.word fee] = pure (.normal next) := by
      unfold internalCallAssign
      have nonempty : (targets d).isEmpty = false := rfl
      simp only [nonempty,Bool.false_eq_true,if_false,write]
    have cap := Inv32Internal.capture _ _ _ _ _ (targets d) _ (called.trans assigned)
    apply pass _ _ _ _ _ _ _ _ _ cap
    exact Inv32Exit.stop _ _ _ _ _ _ [] _ (show Terminates r (some [.word q,.word fee]) _ from
      ⟨next,fun _ => rfl,retValue _ _ _ _ _ _ _ _ _ _ _⟩)
theorem execute (n : Nat) (c : Context) (r : Runtime) (d : Direction) (x y a f : Nat) (o : Option (Nat × Nat))
    (hx : x<R) (hy : y<R) (ha : a<R) (hf : f<R)
    (called : Binds (work r d x y a f 0 0) d o (Stmt.eval (n+1) model.core.table c (work r d x y a f 0 0) (callStmt d))) :
    Terminates r (toValues o) (Stmt.eval (n+5) model.core.table c (top r d x y a f) (selected d).body) := by
  let t := model.core.table
  let out := (top r d x y a f).pushScope
  have inside := innerRun n c r d x y a f o hx hy ha hf called
  have mid := Inv32Exit.block _ t c r out [inner d] _ (Inv32Exit.stop _ _ _ _ _ _ [] _ inside)
  have A := cleanParamExec (n+3) t c out "reserveIn" x hx (by cases d <;> rfl) (by cases d <;> dsimp [out] <;> write_entry)
  have B := cleanParamExec (n+3) t c out "reserveOut" y hy (by cases d <;> rfl) (by cases d <;> dsimp [out] <;> write_entry)
  have C := cleanParamExec (n+3) t c out (input d) a ha (by cases d <;> rfl) (by cases d <;> dsimp [out] <;> write_entry)
  have D := cleanParamExec (n+3) t c out "feeBps" f hf (by cases d <;> rfl) (by cases d <;> dsimp [out] <;> write_entry)
  have S : Stmt.eval (n+4) t c out .skip = pure (.normal out) := by rw [Stmt.eval]
  rw [Inv32Wrapper.checked]; apply Inv32Exit.block
  exact pass _ _ _ _ _ _ _ _ _ A (pass _ _ _ _ _ _ _ _ _ B (pass _ _ _ _ _ _ _ _ _ C (pass _ _ _ _ _ _ _ _ _ D
    (pass _ _ _ _ _ _ _ _ _ S (pass _ _ _ _ _ _ _ _ _ S (Inv32Exit.stop _ _ _ _ _ _ [] _ mid))))))
end Inv32WrapperExec
