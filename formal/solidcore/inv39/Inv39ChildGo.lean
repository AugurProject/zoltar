import Inv39ChildBody
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Child
def beforeCharge (k : Kind) (s : State) (addr val : Nat) :=
  ERC20.afterTo (ERC20.afterFrom s (Motion.fromAddress (motion k) addr) val) (Motion.toAddress (motion k) addr 0) val
theorem goRun (k : Kind) (n : Nat) (c : Context) (r : Runtime) (addr val : Nat)
    (A : r.lookupLocal? "account"=some (.word addr)) (V : r.lookupLocal? "valueAttoRep"=some (.word val))
    (valid : addr<2^160) (nonzero : addr≠0) (fit : val<R)
    (debit : ERC20.fromBounds r.state (Motion.fromAddress (motion k) addr) val)
    (credit : ERC20.toBounds (ERC20.afterFrom r.state (Motion.fromAddress (motion k) addr) val) (Motion.toAddress (motion k) addr 0) val)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ next, Stmt.eval (n+15) model.core.table c r (go k).value = pure (.normal next) ∧
      next.locals=r.locals ∧ next.state.storage=(beforeCharge k r.state addr val).storage := by
  let t := model.core.table
  let one := r.pushScope.declareLocal "_ic_arg_0" (.word addr)
  let two := one.declareLocal "_ic_arg_1" (.word val)
  have a := Inv32Hoist.declEval (n+13) t c r.pushScope "_ic_arg_0" .address (.var "account") addr
    (Inv32Guards.readWord _ _ _ _ _ A) (by rfl)
  have v := Inv32Hoist.declEval (n+13) t c one "_ic_arg_1" .uint256 (Inv03.Bodies.wvar "valueAttoRep").value val
    (Inv32Guards.clean _ _ _ _ _ fit (Inv32Guards.readWord _ _ _ _ _ V)) (by rfl)
  have exclude : motion k ≠ .transfer := by cases k <;> decide
  obtain ⟨done,called,frame,storage⟩ := Motion.call n c two (motion k) addr 0 val "_ic_arg_0" "" "_ic_arg_1" rfl
    (fun h => False.elim (exclude h)) rfl valid (by decide) fit nonzero (fun h => False.elim (exclude h)) debit credit fields events
  simp only [Motion.exprs,if_neg exclude] at called
  have cap := Inv32Internal.capture _ t c two done [] _ called
  refine ⟨done.popScope,?_,?_,storage⟩
  · apply Inv32Hoist.block
    exact (seqStep _ _ _ _ _ _ _ a).trans ((seqStep _ _ _ _ _ _ _ v).trans ((seqStep _ _ _ _ _ _ [] cap).trans
      (show Stmt.evalList (n+14) t c done [] = pure (.normal done) by rw [Stmt.evalList])))
  · change done.locals.drop 1=r.locals
    rw [frame]; rfl
end Inv39.Child
