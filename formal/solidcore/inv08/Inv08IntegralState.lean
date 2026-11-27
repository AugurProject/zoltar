import Inv08ExpiryStorage
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Integral

def rateMember (eth : Bool) : Fin 5 := ⟨rateIndex eth, by cases eth <;> decide⟩
def endMember (eth : Bool) : Fin 5 := ⟨endIndex eth, by cases eth <;> decide⟩
def rate (s : State) (slot : Nat) (eth : Bool) := ExpiryStorage.memberWord s slot (rateMember eth)
def weight (s : State) (slot : Nat) (eth : Bool) := ExpiryStorage.memberWord s slot (endMember eth)
def total (s : State) (latest expired t : Nat) (eth : Bool) :=
  (rate s latest eth - rate s expired eth)*t + weight s expired eth

theorem atSlots (c : Context) (r : Runtime) (eth : Bool) (ls es t : Nat)
    (latest : r.lookupStorageBase? "latest" = some (.slot ls ExpiryStorage.layout))
    (expired : r.lookupStorageBase? "expired" = some (.slot es ExpiryStorage.layout))
    (stamp : r.lookupLocal? "timestamp" = some (.word t)) (tWord : t < R)
    (ordered : rate r.state es eth ≤ rate r.state ls eth) (fits : total r.state ls es t eth < R) :
    Inv40.Reads c r (value eth).value (total r.state ls es t eth) := by
  have rateWord : rate r.state ls eth < R := by
    cases eth <;> change SolidCore.Solidity.Shared.norm _ < R <;> exact Nat.mod_lt _ (by decide)
  exact evaluate c r eth _ _ _ _ ordered rateWord tWord fits
    (ExpiryStorage.memberReads c r _ ls (rateMember eth) latest)
    (ExpiryStorage.memberReads c r _ es (rateMember eth) expired)
    (ExpiryStorage.memberReads c r _ es (endMember eth) expired) stamp

/-- When the generated records store the funding prefixes, each generated
integral expression evaluates to the sum of vested numerators of those streams. -/
theorem fromHistory (c : Context) (r : Runtime) (eth : Bool) (ls es t d : Nat)
    (done live : List Stream)
    (past : ∀ s ∈ done, s.fundedAt+d ≤ t) (future : ∀ s ∈ live, t ≤ s.fundedAt+d)
    (latest : r.lookupStorageBase? "latest" = some (.slot ls ExpiryStorage.layout))
    (expired : r.lookupStorageBase? "expired" = some (.slot es ExpiryStorage.layout))
    (stamp : r.lookupLocal? "timestamp" = some (.word t)) (tWord : t < R)
    (allRates : rate r.state ls eth = totalRate (done++live))
    (expiredRates : rate r.state es eth = totalRate done)
    (weights : weight r.state es eth = weightedEnds d done)
    (fits : integral d t (done++live) < R) :
    Inv40.Reads c r (value eth).value (integral d t (done++live)) := by
  have eq : integral d t (done++live) = total r.state ls es t eth := by
    rw [prefixIntegral _ _ _ _ past future,total,allRates,expiredRates,weights]
  rw [eq] at fits ⊢
  apply atSlots _ _ _ _ _ _ latest expired stamp tWord _ fits
  simp [expiredRates,allRates,totalRate]

end Inv08.Integral
