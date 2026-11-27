import Inv08CheckpointResult
import Inv08FundingDomain
import Inv08Genesis
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.FundingHistory
def Budgeted (s : State) : Prop := ∀ eth,stored s (outstandingField eth) + stored s (Checkpoint.deferredField eth)<2^128

theorem genesisBudget (s : State) (tm d : Nat) (zero : ∀ i,s.loadSlot i=0) : Budgeted (initializeStorage s tm d) := by
  have other (i : Nat) (diff : Shared.norm i≠0) : (initializeStorage s tm d).loadSlot i=0 := by
    change ((s.storeSlot 0 _).storeSlot 0 _).loadSlot i=_
    simp only [slotAfter,show Shared.norm 0=0 from rfl,if_neg diff.symm,zero]
  intro eth
  cases eth
  · change (initializeStorage s tm d).loadSlot 2+(initializeStorage s tm d).loadSlot 4 < _
    rw [other 2 (by decide),other 4 (by decide)]; decide
  · change (initializeStorage s tm d).loadSlot 1+(initializeStorage s tm d).loadSlot 3 < _
    rw [other 1 (by decide),other 3 (by decide)]; decide

theorem releaseBudget (s : State) (tm : Nat) (r : Release.Ready s tm) (b : Budgeted s) : Budgeted (Release.post s tm) := by
  intro eth
  rw [(Release.amounts _ _ eth r).2,Checkpoint.beforeDeferred]
  exact lt_of_le_of_lt (Nat.add_le_add_right (Nat.sub_le _ _) _) (b eth)

theorem addDeferred (s : State) (f : Funding) (p : ExpiryStorage.Record) (eth : Bool) (sep : Separated limit)
    (bound : AddStream.nextId s f p≤limit) :
    stored (AddStream.post s f p) (Checkpoint.deferredField eth)=stored s (Checkpoint.deferredField eth) := by
  unfold AddStream.post AddStream.withEthCursor AddStream.withRecord
  cases eth <;> simp only [Checkpoint.deferredField,Bool.false_eq_true,if_false,if_true]
  all_goals rw [AddStream.otherField _ .repCursor _ _ (by decide),AddStream.otherField _ .ethCursor _ _ (by decide),
    afterRecord _ _ _ bound sep,AddStream.afterId _ _ _ _ (by decide),AddStream.olderScalar _ _ _ (by decide) (by decide)]

theorem addBudget (s : State) (f : Funding) (p : ExpiryStorage.Record) (sep : Separated limit)
    (bound : AddStream.nextId s f p≤limit)
    (room : ∀ eth,stored s (outstandingField eth)+(stream eth f).budget+stored s (deferredField eth)<2^128) :
    Budgeted (AddStream.post s f p) := by
  intro eth
  have fit := lt_trans (lt_of_le_of_lt (Nat.le_add_right _ _) (room eth)) (by decide : 2^128<R)
  rw [AddStream.debitFields _ _ _ _ sep bound eth fit,addDeferred _ _ _ _ sep bound]
  exact room eth

theorem budgetTransport (s t : State) (same : t.storage=s.storage) (b : Budgeted s) : Budgeted t := by
  have fld (k : Field) := scalarCongr t s k (by simp [State.loadSlot,same])
  intro eth
  rw [fld,fld]
  exact b eth
end Inv08.FundingHistory
