import Inv39RejectedCall
import Inv39ZeroCall
import Inv39CapNecessity
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Child
inductive Rejection (s : State) (addr val : Nat) : Kind → RevertData → Prop where
  | low (nonzero : addr≠0) (insufficient : s.loadSlot (balanceSlot addr)<val) : Rejection s addr val .burn ERC20.lowFunds
  | zero (k : Kind) (bad : addr=0) : Rejection s addr val k (Motion.zeroError (motion k) addr)
theorem goRejected (k : Kind) (n : Nat) (c : Context) (r : Runtime) (addr val : Nat)
    (A : r.lookupLocal? "account"=some (.word addr)) (V : r.lookupLocal? "valueAttoRep"=some (.word val))
    (valid : addr<2^160) (fit : val<R) (err : RevertData) (bad : Rejection r.state addr val k err)
    (fields : c.storageFields=model.core.context.storageFields) :
    ∃ next, Stmt.eval (n+15) model.core.table c r (go k).value = pure (.reverted next err) := by
  let t := model.core.table
  let one := r.pushScope.declareLocal "_ic_arg_0" (.word addr)
  let two := one.declareLocal "_ic_arg_1" (.word val)
  have a := Inv32Hoist.declEval (n+13) t c r.pushScope "_ic_arg_0" .address (.var "account") addr
    (Inv32Guards.readWord _ _ _ _ _ A) (by rfl)
  have v := Inv32Hoist.declEval (n+13) t c one "_ic_arg_1" .uint256 (Inv03.Bodies.wvar "valueAttoRep").value val
    (Inv32Guards.clean _ _ _ _ _ fit (Inv32Guards.readWord _ _ _ _ _ V)) (by rfl)
  have nt : motion k≠.transfer := by cases k <;> decide
  have call : ∃ out, Stmt.eval (n+13) t c two (.internalCall [] (Motion.key (motion k)) (Motion.exprs (motion k) "_ic_arg_0" "" "_ic_arg_1"))=pure (.reverted out err) := by
    cases bad with
    | low nz low =>
      exact Motion.rejectedCall n c two .burn addr 0 val _ _ _ rfl (by intro h; cases h) rfl valid (by decide) fit nz (by intro h; cases h) (by decide) low fields
    | zero k bad =>
      exact Motion.zeroCall n c two (motion k) addr 0 val _ _ _ rfl (by intro h; contradiction) rfl valid (by decide) fit (.inl bad)
  obtain ⟨done,called⟩ := call
  simp only [Motion.exprs,if_neg nt] at called
  have cap := Inv32Revert.capture _ t c two done _ [] _ called
  exact ⟨done.popScope,Inv32Revert.blockRevert _ t c r done _ _ ((seqStep _ _ _ _ _ _ _ a).trans
    ((seqStep _ _ _ _ _ _ _ v).trans (Inv32Revert.stop _ _ _ _ _ _ [] _ cap)))⟩
theorem underfundedBurn (s : State) (caller self a v : Nat) (callerFit : caller<R) (auth : s.immutable? "zoltar"=some (.word caller))
    (valid : a<2^160) (nz : a≠0) (fit : v<R) (low : s.loadSlot (balanceSlot a)<v) :
    TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "burn") (callContext caller self) s [.word a,.word v] =
      some (.reverted s ERC20.lowFunds.untagFixedBytes) := by
  let c := callContext caller self
  let r := CheckedWordCall.initial c s
  let inner := (enter r a v).pushScope.pushScope.pushScope
  obtain ⟨out,fail⟩ := goRejected .burn 49980 c inner.pushScope a v rfl rfl valid fit _ (.low nz low) rfl
  have effect := Inv32Revert.blockRevert 49995 model.core.table c inner out _ _
    (Inv32Revert.stop _ _ _ _ _ _ [cost.value,(logged .burn).value] _ fail)
  exact dispatchRejected .burn s caller self a v _ _ (wrapRejected .burn 49995 model.core.table c r a v fit callerFit rfl auth _ _ effect)
theorem zeroAddressRejected (k : Kind) (s : State) (caller self v : Nat) (callerFit : caller<R) (auth : s.immutable? "zoltar"=some (.word caller))
    (fit : v<R) (capFit : s.loadSlot theoretical.slot<R) (allowed : k=.mint → s.loadSlot circulating.slot+v≤s.loadSlot theoretical.slot) :
    TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name (entryName k)) (callContext caller self) s [.word 0,.word v] =
      some (.reverted s (Motion.zeroError (motion k) 0).untagFixedBytes) := by
  let c := callContext caller self
  let r := CheckedWordCall.initial c s
  let inner := (enter r 0 v).pushScope.pushScope.pushScope
  let rt := inner.pushScope
  obtain ⟨out,fail⟩ := goRejected k 49980 c rt 0 v rfl rfl (by decide) fit _ (.zero k rfl) rfl
  apply dispatchRejected k s caller self 0 v
  apply wrapRejected k 49995 model.core.table c r 0 v fit callerFit rfl auth
  cases k with
  | burn => exact Inv32Revert.blockRevert 49995 model.core.table c inner out _ _ (Inv32Revert.stop _ _ _ _ _ _ _ _ fail)
  | mint =>
    have checked := guardRun 49988 c rt _ v _ rfl rfl rfl capFit (allowed rfl) rfl
    exact Inv32Revert.blockRevert 49995 model.core.table c inner out _ _ ((seqStep _ _ _ _ _ _ _ checked).trans (Inv32Revert.stop _ _ _ _ _ _ _ _ fail))
end Inv39.Child
