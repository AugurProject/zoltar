import Inv08MappedRecord
import Inv08Prefix
open Inv32Division
namespace Inv08.FundingHistory
structure Funding where
  time : Nat
  eth : Nat
  rep : Nat

def stream (eth : Bool) (f : Funding) : Stream := ⟨f.time,if eth then f.eth else f.rep⟩
def streams (eth : Bool) (fs : List Funding) := fs.map (stream eth)

def record (d : Nat) (fs : List Funding) : ExpiryStorage.Record := {
  endAt := (fs.getLast?.map (fun f => f.time+d)).getD 0
  ethRate := totalRate (streams true fs)
  repRate := totalRate (streams false fs)
  ethWeighted := weightedEnds d (streams true fs)
  repWeighted := weightedEnds d (streams false fs) }

def add (d : Nat) (previous : ExpiryStorage.Record) (f : Funding) : ExpiryStorage.Record := {
  endAt := f.time+d
  ethRate := previous.ethRate+f.eth
  repRate := previous.repRate+f.rep
  ethWeighted := previous.ethWeighted+f.eth*(f.time+d)
  repWeighted := previous.repWeighted+f.rep*(f.time+d) }

theorem append (d : Nat) (fs : List Funding) (f : Funding) :
    record d (fs++[f]) = add d (record d fs) f := by
  simp [record,add,streams,stream,totalRate,weightedEnds,List.map_append,List.sum_append]

def merge (a b : Funding) : Funding := ⟨a.time,a.eth+b.eth,a.rep+b.rep⟩

theorem sameSecond (d : Nat) (earlier : List Funding) (a b : Funding) (same : a.time=b.time) :
    record d (earlier++[merge a b]) = add d (record d (earlier++[a])) b := by
  rw [append,append]
  simp [add,merge,same,Nat.add_mul,Nat.add_assoc]

theorem addBaseline (fs : List Funding) (eth : Bool) (f : Funding) :
    baseline (streams eth (fs++[f])) =
      baseline (streams eth fs) + (stream eth f).budget * f.time := by
  simp [baseline,streams,List.sum_append,stream]

theorem mergeBaseline (fs : List Funding) (eth : Bool) (a b : Funding) (same : a.time=b.time) :
    baseline (streams eth (fs++[merge a b])) =
      baseline (streams eth (fs++[a,b])) := by
  cases eth <;> simp [baseline,streams,stream,merge,same,List.sum_append,Nat.add_mul,Nat.add_assoc]

end Inv08.FundingHistory
