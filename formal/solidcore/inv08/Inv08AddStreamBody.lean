import Inv08AddStreamBudget
import Inv08AddStreamExpiry
open SolidCore.Solidity.Source Inv32Division Inv03.Bodies
namespace Inv08.AddStream
open ExpiryStorage FundingHistory
def frame (f : Funding) : Frame := [("ethAmount",.word f.eth),("repAmount",.word f.rep)]
def finalRuntime (r : Runtime) (f : Funding) (p : Record) : Runtime :=
  {allocated (r.withFrame (frame f)) p with state:=post r.state f p}
macro "funding_assign" : tactic => `(tactic|
  simp [Runtime.assignLocal?,Runtime.withFrame,Runtime.pushScope,LocalEnv.assign?,Frame.assign?,frame,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Value.coerceLike?])
theorem paramEval (n : Nat) (c : Context) (r : Runtime) (name : String) (v : Nat)
    (found : r.lookupLocal? name=some (.word v)) (fits : v<R) (unchanged : r.assignLocal? name (.word v)=some r) :
    (param name).value.eval (n+1) model.core.table c r = pure (.normal r) := by
  exact Inv32Assign.scalarCast n _ _ _ _ name v v _ _ _ found
    (ReleaseQuote.readClean (localReads c r name v found) fits _ (Nat.le_succ _)) unchanged
private theorem cursorAt (n : Nat) (c : Context) (r : Runtime) (eth : Bool) (a tm v : Nat)
    (fields : c.storageFields=model.core.context.storageFields)
    (found : r.lookupLocal? (FundingRecord.amountName eth)=some (.word a)) (af : a<R) (tf : tm<R)
    (time : stored r.state .through=tm) (org : stored r.state (cursorField eth)=v) (fits : v+a*tm<R) :
    (cursor eth).value.eval (n+1) model.core.table c r = pure (.normal
      {r with state:=r.state.storeFieldWord (cursorField eth).field (v+a*tm)}) := by
  subst v
  exact cursorWrite _ _ _ _ _ _ fields found af tf time fits
private theorem cursorInState (n : Nat) (c : Context) (r : Runtime) (s : State) (hs : r.state=s)
    (eth : Bool) (a tm v : Nat) (fields : c.storageFields=model.core.context.storageFields)
    (found : r.lookupLocal? (FundingRecord.amountName eth)=some (.word a)) (af : a<R) (tf : tm<R)
    (time : stored s .through=tm) (org : stored s (cursorField eth)=v) (fits : v+a*tm<R) :
    (cursor eth).value.eval (n+1) model.core.table c r = pure (.normal
      {r with state:=s.storeFieldWord (cursorField eth).field (v+a*tm)}) := by
  subst s; exact cursorAt n c r eth a tm v fields found af tf time org fits

private theorem storeInState (n : Nat) (c : Context) (r : Runtime) (s : State) (hs : r.state=s)
    (id : Nat) (e : Record) (fields : c.storageFields=model.core.context.storageFields) (current : stored s .latest=id)
    (fit : id<2^48) (rhs : Expr.eval c r (.tuple FundingRecord.expected.value)=pure (.tuple e.words,r)) :
    store.value.eval (n+1) model.core.table c r=pure (.normal {r with state:=install s (mappingStorageSlot 7 id) e}) := by
  subst s; exact storeTuple n c r id e fields current fit rhs

private theorem actionsFromSteps (fuel : Nat) (t : FunctionTable) (c : Context)
    (a b j e g q k l m u v : Runtime)
    (A : timeGuard.value.eval fuel t c a=pure (.normal a))
    (E : endGuard.value.eval fuel t c a=pure (.normal a))
    (F : amountGuard.value.eval fuel t c a=pure (.normal a))
    (O : (outstanding true).value.eval fuel t c a=pure (.normal b))
    (O' : (outstanding false).value.eval fuel t c b=pure (.normal j))
    (B : budget.value.eval fuel t c j=pure (.normal j))
    (R1 : (rate true).value.eval fuel t c j=pure (.normal e))
    (R2 : (rate false).value.eval fuel t c e=pure (.normal g))
    (T : ending.value.eval fuel t c g=pure (.normal q))
    (Q : previous.value.eval fuel t c q=pure (.normal k))
    (I : appendId.value.eval fuel t c k=pure (.normal l))
    (W : store.value.eval fuel t c l=pure (.normal m))
    (C1 : (cursor true).value.eval fuel t c m=pure (.normal u))
    (C2 : (cursor false).value.eval fuel t c u=pure (.normal v))
    : Stmt.evalList fuel t c a (actions.map (·.value))=pure (.normal v) := by
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ A)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ E)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ F)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ O)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ O')
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ B)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ R1)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ R2)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ T)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ Q)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ I)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ W)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ C1)
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] C2).trans (by rw [Stmt.evalList])
private def start (r : Runtime) (f : Funding) : Runtime := (r.withFrame (frame f)).pushScope.pushScope
private def paidEth (r : Runtime) (f : Funding) : Runtime := {(start r f) with state:=withEth r.state f}
private def paidBoth (r : Runtime) (f : Funding) : Runtime := {(start r f) with state:=withOutstanding r.state f}
private def rateEth (r : Runtime) (f : Funding) : Runtime := (paidBoth r f).declareLocal "ethRateNumerator" (.word f.eth)
private def rateBoth (r : Runtime) (f : Funding) : Runtime := (rateEth r f).declareLocal "repRateNumerator" (.word f.rep)
private def withEnd (r : Runtime) (f : Funding) : Runtime := (rateBoth r f).declareLocal "end" (.word (f.time+(stored r.state .duration)))
private def withSnapshot (r : Runtime) (f : Funding) (p : Record) : Runtime := snapshot (withEnd r f) p
private def selectId (r : Runtime) (f : Funding) (p : Record) : Runtime := {(withSnapshot r f p) with state:=withId r.state f p}
private def mapped (r : Runtime) (f : Funding) (p : Record) : Runtime := {selectId r f p with state:=withRecord r.state f p}
private def cursorEth (r : Runtime) (f : Funding) (p : Record) : Runtime := {mapped r f p with state:=withEthCursor r.state f p}
private def done (r : Runtime) (f : Funding) (p : Record) : Runtime := {cursorEth r f p with state:=post r.state f p}
private theorem memoryWithState (r : Runtime) (s : State) (p : Record) (mem : Snapshot r p) :
    Snapshot {r with state:=s} p := ⟨mem.pointer⟩

private theorem stateOfMapped (r : Runtime) (f : Funding) (p : Record) : (mapped r f p).state=withRecord r.state f p := rfl
private theorem stateOfCredit (r : Runtime) (f : Funding) (p : Record) : (cursorEth r f p).state=withEthCursor r.state f p := rfl
private theorem ethLocal (r : Runtime) (f : Funding) (p : Record) :
    (mapped r f p).lookupLocal? (FundingRecord.amountName true)=some (.word f.eth) := rfl
private theorem repLocal (r : Runtime) (f : Funding) (p : Record) :
    (cursorEth r f p).lookupLocal? (FundingRecord.amountName false)=some (.word f.rep) := rfl

private theorem checkedGuards (n : Nat) (c : Context) (r : Runtime) (f : Funding) (p : Record)
    (fields : c.storageFields=model.core.context.storageFields) (clock : EnvWord.blockTimestamp.eval c=f.time)
    (dom : Domain r.state f p) :
    timeGuard.value.eval (n+6) model.core.table c (start r f) = pure (.normal (start r f)) ∧
    endGuard.value.eval (n+6) model.core.table c (start r f) = pure (.normal (start r f)) ∧
    amountGuard.value.eval (n+6) model.core.table c (start r f) = pure (.normal (start r f)) := by
  let s := r.state
  let d := (stored r.state .duration)
  let a := (start r f)
  have tf48 : f.time<2^48 := lt_of_le_of_lt (Nat.le_add_right _ _) dom.endFits
  have tf : f.time<R := lt_trans tf48 (by decide)
  have ef : f.eth<R := lt_of_le_of_lt (Nat.le_add_left _ _) dom.ethSum
  have rf : f.rep<R := lt_of_le_of_lt (Nat.le_add_left _ _) dom.repSum
  have A := timeOK (n+5) c a _ clock fields dom.nowEq tf
  have E := endOK (n+5) c a fields (by change stored s .through+d<2^48; rw [dom.nowEq]; exact dom.endFits)
  have F := amountOK (n+5) c a f.eth f.rep ef rf dom.funded rfl rfl
  exact ⟨A,E,F⟩
private theorem checkedBudget (n : Nat) (c : Context) (r : Runtime) (f : Funding) (p : Record)
    (fields : c.storageFields=model.core.context.storageFields)
    (dom : Domain r.state f p) (stages : StageReads r.state f p) :
    (outstanding true).value.eval (n+6) model.core.table c (start r f) = pure (.normal (paidEth r f)) ∧
    (outstanding false).value.eval (n+6) model.core.table c (paidEth r f) = pure (.normal (paidBoth r f)) ∧
    budget.value.eval (n+6) model.core.table c (paidBoth r f) = pure (.normal (paidBoth r f)) := by
  let s := r.state
  let t := model.core.table
  let a := (start r f)
  let b := (paidEth r f)
  let j := (paidBoth r f)
  have O : (outstanding true).value.eval (n+6) t c a=pure (.normal b) := outstandingWrite (n+5) c a true f.eth fields rfl dom.ethSum
  have O' : (outstanding false).value.eval (n+6) t c b=pure (.normal j) := by
    have repOld : stored b.state (outstandingField false)=stored s .repOut := stages.repOutstanding
    have h := outstandingWrite (n+5) c b false f.rep fields rfl (repOld ▸ dom.repSum)
    dsimp only at h; rw [repOld] at h; exact h
  have B := budgetCheck n c j fields dom.ethBudget dom.repBudget
  exact ⟨O,O',B⟩
private theorem checkedSetup (n : Nat) (c : Context) (r : Runtime) (f : Funding) (p : Record)
    (fields : c.storageFields=model.core.context.storageFields)
    (dom : Domain r.state f p) (stages : StageReads r.state f p) :
    (rate true).value.eval (n+6) model.core.table c (paidBoth r f) = pure (.normal (rateEth r f)) ∧
    (rate false).value.eval (n+6) model.core.table c (rateEth r f) = pure (.normal (rateBoth r f)) ∧
    ending.value.eval (n+6) model.core.table c (rateBoth r f) = pure (.normal (withEnd r f)) ∧
    previous.value.eval (n+6) model.core.table c (withEnd r f) = pure (.normal (withSnapshot r f p)) := by
  let d := (stored r.state .duration)
  let id := (stored r.state .latest)
  let j := (paidBoth r f)
  let e := (rateEth r f)
  let g := (rateBoth r f)
  let q := (withEnd r f)
  have ef : f.eth<R := lt_of_le_of_lt (Nat.le_add_left _ _) dom.ethSum
  have rf : f.rep<R := lt_of_le_of_lt (Nat.le_add_left _ _) dom.repSum
  have idf : id<2^48 := lt_of_le_of_lt (Nat.le_add_right _ _) dom.idFit
  have R1 := rateDecl (n+5) c j true f.eth ef rfl
  have R2 := rateDecl (n+5) c e false f.rep rf rfl
  have T := endDecl (n+5) c g f.time d fields stages.through stages.duration dom.endFits
  have Q := previousSetup (n+5) c q id p fields stages.latest idf stages.previousTuple
  exact ⟨R1,R2,T,Q⟩
private theorem selects (n : Nat) (c : Context) (r : Runtime) (f : Funding) (p : Record)
    (fields : c.storageFields=model.core.context.storageFields)
    (dom : Domain r.state f p) (stages : StageReads r.state f p) (pf : p.endAt<2^48) :
    appendId.value.eval (n+6) model.core.table c (withSnapshot r f p) = pure (.normal (selectId r f p)) := by
  let t := model.core.table
  let d := (stored r.state .duration)
  let id := (stored r.state .latest)
  let q := (withEnd r f)
  let k := (withSnapshot r f p)
  let l := (selectId r f p)
  have K := snapRead q p
  have I : appendId.value.eval (n+6) t c k=pure (.normal l) := by
    have inc := chooseId (n+4) c k p id (f.time+d) K rfl pf dom.endFits fields stages.latest dom.idFit
    by_cases equal : p.endAt=f.time+stored r.state .duration
    · simpa only [d,l,selectId,withId,equal,if_true] using inc
    · simpa only [d,l,selectId,withId,nextId,equal,if_false] using inc
  exact I
private theorem stores (n : Nat) (c : Context) (r : Runtime) (f : Funding) (p : Record)
    (fields : c.storageFields=model.core.context.storageFields)
    (dom : Domain r.state f p) (stages : StageReads r.state f p) :
    store.value.eval (n+6) model.core.table c (selectId r f p) = pure (.normal (mapped r f p)) := by
  let d := stored r.state .duration
  let l := selectId r f p
  have K := snapRead (withEnd r f) p
  have mem : Snapshot l p := memoryWithState (withSnapshot r f p) (withId r.state f p) p K
  have val := tupleRhs c l f d p mem rfl rfl rfl dom.recordFit
  unfold mapped withRecord
  exact storeInState (n+5) c l (withId r.state f p) rfl (nextId r.state f p) (add d p f) fields stages.finalId dom.idFit val
private theorem advancesEth (n : Nat) (c : Context) (r : Runtime) (f : Funding) (p : Record)
    (fields : c.storageFields=model.core.context.storageFields)
    (dom : Domain r.state f p) (stages : StageReads r.state f p) :
    (cursor true).value.eval (n+6) model.core.table c (mapped r f p) = pure (.normal (cursorEth r f p)) := by
  have tf48 : f.time<2^48 := lt_of_le_of_lt (Nat.le_add_right _ _) dom.endFits
  have tf : f.time<R := lt_trans tf48 (by decide)
  have ef : f.eth<R := lt_of_le_of_lt (Nat.le_add_left _ _) dom.ethSum
  unfold cursorEth withEthCursor
  exact cursorInState (n+5) c (mapped r f p) (withRecord r.state f p) (stateOfMapped r f p) true f.eth f.time (stored r.state .ethCursor)
    fields (ethLocal r f p) ef tf stages.mappedThrough stages.mappedEthCursor dom.ethCursor
private theorem advancesRep (n : Nat) (c : Context) (r : Runtime) (f : Funding) (p : Record)
    (fields : c.storageFields=model.core.context.storageFields)
    (dom : Domain r.state f p) (stages : StageReads r.state f p) :
    (cursor false).value.eval (n+6) model.core.table c (cursorEth r f p) = pure (.normal (done r f p)) := by
  have tf48 : f.time<2^48 := lt_of_le_of_lt (Nat.le_add_right _ _) dom.endFits
  have tf : f.time<R := lt_trans tf48 (by decide)
  have rf : f.rep<R := lt_of_le_of_lt (Nat.le_add_left _ _) dom.repSum
  unfold done post
  exact cursorInState (n+5) c (cursorEth r f p) (withEthCursor r.state f p) (stateOfCredit r f p) false f.rep f.time (stored r.state .repCursor)
    fields (repLocal r f p) rf tf stages.ethThrough stages.ethRepCursor dom.repCursor
private theorem finishScopes (r : Runtime) (f : Funding) (p : Record) :
    (done r f p).popScope.popScope=finalRuntime r f p := by
  simp only [done,cursorEth,mapped,selectId,withSnapshot,snapshot,allocated,withEnd,rateBoth,rateEth,
    paidBoth,start,finalRuntime,Runtime.popScope,Runtime.allocMemory,Runtime.declareLocal,Runtime.pushScope,
    Runtime.withFrame,LocalEnv.declare,List.drop]


set_option maxHeartbeats 1400000 in
theorem executeRaw (n : Nat) (c : Context) (r : Runtime) (f : Funding) (p : Record)
    (fields : c.storageFields=model.core.context.storageFields) (clock : EnvWord.blockTimestamp.eval c=f.time)
    (dom : Domain r.state f p) (stages : StageReads r.state f p) (pf : p.endAt<2^48) :
    body.value.eval (n+8) model.core.table c (r.withFrame (frame f)) = pure (.normal (finalRuntime r f p)) := by
  let t := model.core.table
  let base := (r.withFrame (frame f))
  let a := (start r f)
  let b := (paidEth r f)
  let j := (paidBoth r f)
  let e := (rateEth r f)
  let g := (rateBoth r f)
  let q := (withEnd r f)
  let k := (withSnapshot r f p)
  let l := (selectId r f p)
  let m := (mapped r f p)
  let u := (cursorEth r f p)
  let v := (done r f p)
  obtain ⟨A,E,F⟩ := checkedGuards n c r f p fields clock dom
  obtain ⟨O,O',B⟩ := checkedBudget n c r f p fields dom stages
  obtain ⟨R1,R2,T,Q⟩ := checkedSetup n c r f p fields dom stages
  have I := selects n c r f p fields dom stages pf
  have W := stores n c r f p fields dom stages
  have C1 := advancesEth n c r f p fields dom stages
  have C2 := advancesRep n c r f p fields dom stages
  have ef : f.eth<R := lt_of_le_of_lt (Nat.le_add_left _ _) dom.ethSum
  have rf : f.rep<R := lt_of_le_of_lt (Nat.le_add_left _ _) dom.repSum
  have actionsRun := actionsFromSteps (n+6) t c a b j e g q k l m u v A E F O O' B R1 R2 T Q I W C1 C2
  have inner := Inv32Hoist.block (n+6) t c base.pushScope v _ actionsRun
  change (Inv03.Bodies.block actions).value.eval (n+7) t c base.pushScope=pure (.normal v.popScope) at inner
  have U := paramEval (n+6) c base.pushScope "ethAmount" f.eth rfl ef (by dsimp [base]; funding_assign)
  have V := paramEval (n+6) c base.pushScope "repAmount" f.rep rfl rf (by dsimp [base]; funding_assign)
  rw [←finishScopes]
  apply Inv32Hoist.block (n+7) t c base v.popScope _
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ U)
  apply Eq.trans (Inv32FloorStart.seqStep _ _ _ _ _ _ _ V)
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ [] inner).trans (by rw [Stmt.evalList])
end Inv08.AddStream