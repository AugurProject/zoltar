import Inv39MovementMarkerTransfer
import Inv39DelegateBody
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Allowance
theorem delegateBodyMarker (n : Nat) (c : Context) (r : Runtime) (A : Nat → Prop) (b : Balances) (x y v old : Nat)
    (X : A x) (Y : A y) (xw : x<2^160) (yw : y<2^160) (sw : c.sender<2^160) (xn : x≠0) (yn : y≠0) (sn : old<R-1 → c.sender≠0)
    (atSlot : r.state.loadSlot (slot x c.sender)=old) (oldFit : old<R) (allowed : old<R-1 → v≤old) (separate : old<R-1 → Separate A x c.sender)
    (book : Books A r.state b) (sep : SlotSeparation A) (enough : v≤balance x b) (fit : total b<R)
    (marker : BalanceApart A) (allowMarker : old<R-1 → Init.MarkerHistory.Apart (slot x c.sender))
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    ∃ post, Stmt.eval (n+19) model.core.table c (delegateStart r x y v) publicShape.value=pure (.returned post [.word 1]) ∧
      Books A post.state (move x y v b) ∧ post.state.loadSlot theoretical.slot=r.state.loadSlot theoretical.slot ∧ post.state.loadSlot 7=r.state.loadSlot 7 := by
  let t := model.core.table
  let enter := delegateStart r x y v
  let outer := enter.pushScope
  let fetched := Child.stateTmp outer c.sender
  let named := fetched.declareLocal "spender" (.word c.sender)
  have vf := lt_of_le_of_lt (le_trans enough (balanceLE x b)) fit
  have z := Transfer.zeroAddress (n+16) t c outer.pushScope Transfer.tmp
  have get := Transfer.fetchRun (n+11) c outer
  have sp := Inv32Hoist.declEval (n+16) t c fetched "spender" .address (.var Transfer.tmp) c.sender (Inv32Guards.readWord _ _ _ _ _ rfl) rfl
  obtain ⟨charged,ev,locals,store⟩ := prepSpend n c named x c.sender v old rfl rfl rfl atSlot oldFit allowed xw sw (fun _ => xn) sn vf fields events
  have prior : Books A named.state b := book
  have kept := framed named.state A b x c.sender old v prior separate
  have chargedBook := Books.ofStorageEq store kept.1
  have cap : charged.state.loadSlot theoretical.slot=r.state.loadSlot theoretical.slot := by
    simpa only [State.loadSlot,store] using kept.2
  have chargedMarker : charged.state.loadSlot 7=r.state.loadSlot 7 := by
    have same : (afterSpend named.state x c.sender old v).loadSlot 7=named.state.loadSlot 7 := by
      unfold afterSpend
      split
      · exact Init.MarkerHistory.store _ _ _ (allowMarker ‹old<R-1›)
      · rfl
    simpa only [State.loadSlot,store] using same
  let ready := three charged x y v
  obtain ⟨done,call,_,finalBook,finalCap,finalMark⟩ := Inv39.transferCallMarker (n+2) c ready A b x y v "_ic_arg_0" "_ic_arg_1" "_ic_arg_2"
    rfl rfl rfl xw yw xn yn X Y sep chargedBook enough fit marker fields events
  have ls (name : String) : charged.lookupLocal? name=named.lookupLocal? name := by simp [Runtime.lookupLocal?,locals]
  have Yread : (charged.pushScope.declareLocal "_ic_arg_0" (.word x)).lookupLocal? "to"=some (.word y) :=
    ls "to" |>.trans rfl
  have moved := prepOK (n+15) c charged "from" "to" (Motion.key .transfer) x y v ((ls _).trans rfl) Yread ((ls _).trans rfl) vf done call
  have ret := Transfer.returns (.word 1) c done.popScope 1 t (n+16) rfl
  have block := blockReturned (n+17) t c outer done.popScope _ _ ((seqStep _ _ _ _ _ _ _ z).trans ((seqStep _ _ _ _ _ _ _ get).trans
    ((seqStep _ _ _ _ _ _ _ sp).trans ((seqStep _ _ _ _ _ _ _ ev).trans ((seqStep _ _ _ _ _ _ _ moved).trans (stop _ _ _ _ _ _ [] _ ret)))) ))
  have sk : Stmt.eval (n+18) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  have prm := cleanParamExec (n+17) t c outer "value" v vf rfl (by dsimp [outer,enter,delegateStart]; write_param)
  refine ⟨done.popScope.popScope.popScope,?_,finalBook,finalCap.trans cap,finalMark.trans chargedMarker⟩
  apply blockReturned
  exact (seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ prm).trans
    ((seqStep _ _ _ _ _ _ _ sk).trans (stop _ _ _ _ _ _ [] _ block))))
end Inv39.Allowance
