import Inv39Sender
import Inv39TransferCore
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Transfer
theorem goRun (n : Nat) (c : Context) (r : Runtime) (A : Nat → Prop) (b : Balances) (dst val : Nat)
    (X : r.lookupLocal? "owner"=some (.word c.sender)) (Y : r.lookupLocal? "to"=some (.word dst)) (Z : r.lookupLocal? "value"=some (.word val))
    (sv : c.sender<2^160) (dv : dst<2^160) (sn : c.sender≠0) (dn : dst≠0) (S : A c.sender) (D : A dst)
    (sep : SlotSeparation A) (book : Books A r.state b) (enough : val≤balance c.sender b) (fit : total b<R)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ next, Stmt.eval (n+15) model.core.table c r go.value=pure (.normal next) ∧ next.locals=r.locals ∧
      Books A next.state (move c.sender dst val b) ∧ next.state.loadSlot theoretical.slot=r.state.loadSlot theoretical.slot := by
  let t := model.core.table
  let one := r.pushScope.declareLocal "_ic_arg_0" (.word c.sender)
  let two := one.declareLocal "_ic_arg_1" (.word dst)
  let three := two.declareLocal "_ic_arg_2" (.word val)
  have vw := lt_of_le_of_lt (le_trans enough (balanceLE c.sender b)) fit
  have a := Inv32Hoist.declEval (n+13) t c r.pushScope "_ic_arg_0" .address (.var "owner") c.sender (Inv32Guards.readWord _ _ _ _ _ X) rfl
  have d := Inv32Hoist.declEval (n+13) t c one "_ic_arg_1" .address (.var "to") dst (Inv32Guards.readWord _ _ _ _ _ Y) rfl
  have v := Inv32Hoist.declEval (n+13) t c two "_ic_arg_2" .uint256 (Child.cv "value") val (Child.readClean _ _ _ _ _ vw Z) rfl
  obtain ⟨done,ev,locals,books,cap⟩ := transferCall n c three A b c.sender dst val "_ic_arg_0" "_ic_arg_1" "_ic_arg_2" rfl rfl rfl sv dv sn dn S D sep book enough fit fields events
  have call := Inv32Internal.capture _ t c three done [] _ ev
  refine ⟨done.popScope,?_,?_,books,cap⟩
  · apply Inv32Hoist.block
    exact (seqStep _ _ _ _ _ _ _ a).trans ((seqStep _ _ _ _ _ _ _ d).trans ((seqStep _ _ _ _ _ _ _ v).trans ((seqStep _ _ _ _ _ _ [] call).trans
      (show Stmt.evalList (n+14) t c done []=pure (.normal done) by rw [Stmt.evalList]))))
  · change done.locals.drop 1=r.locals
    rw [locals]; rfl
def start (r : Runtime) (dst val : Nat) := r.withFrame [("to",.word dst),("value",.word val),("_ret0",.word 0)]
theorem body (n : Nat) (c : Context) (r : Runtime) (A : Nat → Prop) (b : Balances) (dst val : Nat)
    (sv : c.sender<2^160) (dv : dst<2^160) (sn : c.sender≠0) (dn : dst≠0) (S : A c.sender) (D : A dst)
    (sep : SlotSeparation A) (book : Books A r.state b) (enough : val≤balance c.sender b) (fit : total b<R)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ next, Stmt.eval (n+17) model.core.table c (start r dst val) shape.value=pure (.returned next [.word 1]) ∧
      Books A next.state (move c.sender dst val b) ∧ next.state.loadSlot theoretical.slot=r.state.loadSlot theoretical.slot := by
  let t := model.core.table
  let outer := (start r dst val).pushScope
  let src := Child.stateTmp outer c.sender
  let owned := src.declareLocal "owner" (.word c.sender)
  have vw := lt_of_le_of_lt (le_trans enough (balanceLE c.sender b)) fit
  have z := zeroAddress (n+14) t c outer.pushScope tmp
  have get := fetchRun (n+9) c outer
  have owner := Inv32Hoist.declEval (n+14) t c src "owner" .address (.var tmp) c.sender (Inv32Guards.readWord _ _ _ _ _ rfl) rfl
  obtain ⟨out,moveEval,_,books,cap⟩ := goRun n c owned A b dst val rfl rfl rfl sv dv sn dn S D sep book enough fit fields events
  have ret := returns (.word 1) c out 1 t (n+14) rfl
  have inside := blockReturned (n+15) t c outer out _ _ ((seqStep _ _ _ _ _ _ _ z).trans ((seqStep _ _ _ _ _ _ _ get).trans
    ((seqStep _ _ _ _ _ _ _ owner).trans ((seqStep _ _ _ _ _ _ _ moveEval).trans (stop _ _ _ _ _ _ [] _ ret)))))
  have skip : Stmt.eval (n+16) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  have param := cleanParamExec (n+15) t c outer "value" val vw rfl (by dsimp [outer,start]; write_param)
  refine ⟨out.popScope.popScope,?_,books,cap⟩
  apply blockReturned
  exact (seqStep _ _ _ _ _ _ _ skip).trans ((seqStep _ _ _ _ _ _ _ param).trans ((seqStep _ _ _ _ _ _ _ skip).trans (stop _ _ _ _ _ _ [] _ inside)))
end Inv39.Transfer
