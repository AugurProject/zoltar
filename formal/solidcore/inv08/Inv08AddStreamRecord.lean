import Inv08AddStreamShapes
import Inv08SearchLower
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.AddStream
open ExpiryStorage
def allocated (r : Runtime) (e : Record) := (r.allocMemory (.tuple e.words)).1
def snapshot (r : Runtime) (e : Record) := (allocated r e).declareLocal "previous" (.memoryRef r.nextMemory)
theorem previousSetup (n : Nat) (c : Context) (r : Runtime) (id : Nat) (e : Record)
    (fields : c.storageFields=model.core.context.storageFields) (last : stored r.state .latest=id)
    (fit : id<2^48) (record : tuple r.state (mappingStorageSlot 7 id)=.tuple e.words) :
    previous.value.eval (n+1) model.core.table c r = pure (.normal (snapshot r e)) := by
  let idx := (field48 .latest).value
  let src := Source.Expr.storageRead .element "expiries" [idx]
  have I := Expiry.scalarField c r .latest id fields last fit
  change Inv40.Reads c r idx id at I
  have L := loadRecord c r id (lt_trans fit (by decide)) fields
  rw [record] at L
  have read (k : Nat) : Expr.evalFuel (k+4) c r src = pure (.tuple e.words,r) := by
    change Expr.evalFuel _ c r (.storageRead .element "expiries" [idx]) = _
    rw [Expr.evalFuel]
    change (do let (v,s) ← Expr.evalFuel (k+3) c r idx
               let w ← liftM (s.loadStorageIndex c "expiries" v)
               pure (w,s)) = _
    rw [I (k+3) (by change 3≤k+3; omega)]
    simp only [Authority.bindPure,L,Authority.liftPure]
  have ref : Expr.memoryRefOrValue c r src = pure (none,some (.tuple e.words),r) := by
    change Expr.memoryRefOrValueFuel 6 c r (.storageRead .element "expiries" [idx]) = _
    rw [Expr.memoryRefOrValueFuel]
    change (do let (v,s) ← Expr.evalFuel 5 c r src; pure (none,some v,s)) = _
    rw [read 1]; rfl
    all_goals simp
  change Stmt.eval _ _ _ _ (.memoryVarDecl tupleTy "previous" (some src)) = _
  rw [Stmt.eval]; dsimp only; rw [ref]
  change (match r.declareMemoryLocal tupleTy "previous" (.tuple e.words) with
          | some next => (pure (.normal next) : SolI Result)
          | none => pure (.reverted r RevertData.typeMismatch)) = _
  have assign : r.declareMemoryLocal tupleTy "previous" (.tuple e.words) = some (snapshot r e) := by
    simp [Runtime.declareMemoryLocal,tupleTy,Ty.coerceValue?,Ty.coerceTupleValues?,Record.words,
      Runtime.memoryStoredValue,Runtime.memoryStoredValues,Value.isMemoryObject,Bind.bind,Option.bind]
    rfl
  rw [assign]

structure Snapshot (r : Runtime) (e : Record) : Prop where
  pointer : ∃ id, r.lookupLocal? "previous"=some (.memoryRef id) ∧ r.loadMemory? id=some (.tuple e.words)

theorem snapRead (r : Runtime) (e : Record) : Snapshot (snapshot r e) e := by
  refine ⟨r.nextMemory,?_,?_⟩
  · cases h : r.locals <;> simp [snapshot,allocated,Runtime.allocMemory,Runtime.declareLocal,Runtime.lookupLocal?,
      LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,h]
  · change ((r.memory.insert r.nextMemory (.tuple e.words))[r.nextMemory]?)=_
    exact Std.HashMap.getElem?_insert_self

theorem member (c : Context) (r : Runtime) (e : Record) (i v : Nat) (m : Snapshot r e)
    (fit : i<R) (atIndex : listGet? e.words i=some (.word v)) :
    MemoryMember.Reads c r (Integral.member "previous" i).value v := by
  obtain ⟨id,found,load⟩ := m.pointer
  exact MemoryMember.fromMemory _ _ _ _ _ _ _ found load fit atIndex

private theorem consRead (n : Nat) (c : Context) (r : Runtime) (kind : CastKind) (bits : Nat) (x : Source.Expr) (xs : List Source.Expr)
    (v : Nat) (vs : List Source.Value) (read : Expr.evalFuel n c r (.castOp kind bits x)=pure (.word v,r))
    (tail : Expr.evalTupleListFuel (n+1) c r xs=pure (vs,r)) :
    Expr.evalTupleListFuel (n+2) c r (.castOp kind bits x::xs) = pure (.word v::vs,r) := by
  have ref : Expr.memoryRefOrValueFuel (n+1) c r (.castOp kind bits x) = pure (none,some (.word v),r) := by
    rw [Expr.memoryRefOrValueFuel,read]; rfl
    all_goals simp
  rw [Expr.evalTupleListFuel,ref]; simp only [Authority.bindPure,tail]

theorem tupleRhs (c : Context) (r : Runtime) (f : FundingHistory.Funding) (d : Nat) (p : Record)
    (haveMem : Snapshot r p) (e : r.lookupLocal? "end"=some (.word (f.time+d)))
    (eth : r.lookupLocal? "ethRateNumerator"=some (.word f.eth)) (rep : r.lookupLocal? "repRateNumerator"=some (.word f.rep))
    (fits : Fits (FundingHistory.add d p f)) :
    Expr.eval c r (.tuple FundingRecord.expected.value) = pure (.tuple (FundingHistory.add d p f).words,r) := by
  have endFit := fits.endBound
  have word := lt_trans endFit (by decide : 2^48<R)
  have endVal := Authority.castBits (Authority.castBits (Expiry.local48 c r "end" _ endFit e) 48 (by decide) (by decide) endFit)
    48 (by decide) (by decide) endFit
  have Et := FundingRecord.accumulates c r true f.eth (f.time+d) p.ethRate p.ethWeighted eth e
    (member _ _ _ 1 _ haveMem (by decide) rfl) (member _ _ _ 3 _ haveMem (by decide) rfl)
    word fits.ethBound fits.ethWeightBound
  have Rp := FundingRecord.accumulates c r false f.rep (f.time+d) p.repRate p.repWeighted rep e
    (member _ _ _ 2 _ haveMem (by decide) rfl) (member _ _ _ 4 _ haveMem (by decide) rfl)
    word fits.repBound fits.repWeightBound
  unfold Expr.eval
  rw [Expr.evalFuel]
  simp only
  have enough : Expr.evalTupleListFuel ((Expr.tuple FundingRecord.expected.value).orderFuel) c r FundingRecord.expected.value =
      pure ((FundingHistory.add d p f).words,r) := by
    apply consRead _ c r _ _ _ _ _ _ (endVal _ (by decide))
    apply consRead _ c r _ _ _ _ _ _ (Et.1 _ (by decide))
    apply consRead _ c r _ _ _ _ _ _ (Rp.1 _ (by decide))
    apply consRead _ c r _ _ _ _ _ _ (Et.2 _ (by decide))
    apply consRead _ c r _ _ _ _ _ _ (Rp.2 _ (by decide))
    rfl
  rw [enough]; rfl
end Inv08.AddStream
