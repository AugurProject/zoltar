import Inv36Call
open SolidCore.Solidity.Source Inv32Dispatch Inv32Division Inv32FloorStart Inv32FloorFastPath Inv32Exit
namespace Inv36Source
private def work (r : Runtime) (a p y n : Nat) :=
  (base r a p 0 0).withFrame [(out1,.word n),(out0,.word y),(a1,.word p),(a0,.word a)]
private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl
private theorem returnValues (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (a p y n : Nat) :
    let st := work r a p y n
    Stmt.eval (fuel+1) t c st returnStmt = pure (.returned st [.word y,.word n]) := by
  let st := work r a p y n
  have read (s : String) (v : Nat) (h : st.lookupLocal? s = some (.word v)) :
      Expr.evalReturnValue c st (.var s) = pure (.word v,st) := by
    simp only [Expr.evalReturnValue,Runtime.lookupMemoryRef?,h]; exact Inv32Guards.readWord _ _ _ _ _ h
  have A := read out0 y rfl
  have B := read out1 n rfl
  have vs : Expr.evalReturnList c st [.var out0,.var out1] = pure ([.word y,.word n],st) := by
    change Expr.evalReturnListFuel (_+1+1+1) c st _ = _
    simp only [Expr.evalReturnListFuel,A,B,pb]
  unfold returnStmt; dsimp only; rw [Stmt.eval]; dsimp only; rw [vs]; rfl

private theorem forward (n : Nat) (c : Context) (r : Runtime) (a p : Nat) (ha : a<R) (hp : p<R) :
    Terminates r ((quote a p).map returns) (Stmt.eval (n+22) model.core.table c (base r a p 0 0) inner) := by
  let t := model.core.table
  let start := (base r a p 0 0).pushScope
  let s0 := start.declareLocal a0 (.word a)
  let s1 := s0.declareLocal a1 (.word p)
  let s2 := s1.declareLocal out0 (.word 0)
  let pre := work r a p 0 0
  have A := Inv32Temps.temp (n+20) t c start a0 cn a ha rfl
  have B := Inv32Temps.temp (n+20) t c s0 a1 pn p hp rfl
  have C := zero (n+20) t c s1 out0
  have D := zero (n+20) t c s2 out1
  have k := call n c pre a p ha hp rfl rfl
  apply Inv32Exit.block
  apply pass _ _ _ _ _ _ _ _ _ A
  apply pass _ _ _ _ _ _ _ _ _ B
  apply pass _ _ _ _ _ _ _ _ _ C
  apply pass _ _ _ _ _ _ _ _ _ D
  cases Q : quote a p with
  | none =>
    rw [Q] at k
    obtain ⟨s,e,h⟩ := k
    exact Inv32Exit.stop _ _ _ _ _ _ _ _ (show Terminates r none _ from ⟨s,e,Inv32Revert.capture _ _ _ _ _ _ _ _ h⟩)
  | some z =>
    rw [Q] at k
    let next := work r a p z.1 z.2
    have put : pre.assignNamedValuesRef? [out0,out1] (returns z) = some next := by
      simp [pre,next,work,returns,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,Runtime.assignLocal?,
        Runtime.lookupLocal?,Runtime.withFrame,LocalEnv.assign?,LocalEnv.lookup?,Frame.assign?,Frame.lookup?,
        Value.coerceLike?,out0,out1]
    have assigned : internalCallAssign pre [out0,out1] (returns z) = pure (.normal next) := by
      unfold internalCallAssign; simp [put]
    have cap := Inv32Internal.capture _ _ _ _ _ [out0,out1] _ (k.trans assigned)
    exact pass _ _ _ _ _ _ _ _ _ cap (Inv32Exit.stop _ _ _ _ _ _ [] _ (show Terminates r (some (returns z)) _ from
      ⟨next,fun _ => rfl,returnValues _ _ _ _ _ _ _ _⟩))

theorem publicRun (n : Nat) (c : Context) (r : Runtime) (a p : Nat) (ha : a<R) (hp : p<R) :
    Terminates r ((quote a p).map returns)
      (Stmt.eval (n+24) model.core.table c (r.withFrame (frm a p 0 0)) fn.body) := by
  let src := r.withFrame (frm a p 0 0)
  let outer := src.pushScope
  let t := model.core.table
  have F := forward n c r a p ha hp
  have mid := Inv32Exit.block _ t c r outer [inner] _ (Inv32Exit.stop _ _ _ _ _ _ [] _ F)
  have A := cleanParamExec (n+22) t c outer cn a ha rfl (by dsimp [outer,src]; write_initial)
  have B := cleanParamExec (n+22) t c outer pn p hp rfl (by dsimp [outer,src]; write_initial)
  have S : Stmt.eval (n+23) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  rw [publicBodyShape]; apply Inv32Exit.block
  exact pass _ _ _ _ _ _ _ _ _ A (pass _ _ _ _ _ _ _ _ _ B (pass _ _ _ _ _ _ _ _ _ S
    (pass _ _ _ _ _ _ _ _ _ S (Inv32Exit.stop _ _ _ _ _ _ [] _ mid))))
end Inv36Source
