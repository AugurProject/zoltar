import Inv08CheckpointStep
import Inv08ReachableAccounting
open SolidCore.Solidity.Source
namespace Inv08.Checkpoint
open FundingHistory
def nowAt (c : Context) := EnvWord.blockTimestamp.eval c
def cutoffAt (c : Context) (cutoff : Nat) := min (nowAt c) cutoff
def checkpointOutput (c : Context) (s : State) (cutoff : Nat) := output c s (cutoffAt c cutoff) (nowAt c)

/-- A history observes the state and both actual return words of every public dispatch. -/
def run (fuel cutoff : Nat) (s : State) : List Context → Option (State × Nat × Nat)
  | [] => some (s,0,0)
  | c::cs => do
    let .returned next [.word e,.word p] ← SolidCore.Solidity.TypeCheck.CheckedContract.callTargetWithContext? (fuel+79) model
      (.name "checkpoint") c s [.word (cutoffAt c cutoff)] | none
    let (last,restE,restP) ← run fuel cutoff next cs
    return (last,e+restE,p+restP)

inductive Schedule (cutoff : Nat) : State → Nat → List Context → Nat → Prop
  | nil (s : State) (t : Nat) : Schedule cutoff s t [] t
  | cons (c : Context) (forward : start≤nowAt c) (time : nowAt c<2^48)
      (fields : c.storageFields=model.core.context.storageFields) (free : c.value=0)
      (clone : Authority.Clone c (Release.baseRuntime c s))
      (tail : Schedule cutoff (checkpointOutput c s cutoff) (nowAt c) cs stop) : Schedule cutoff s start (c::cs) stop

theorem fundedCheckpoint (c : Context) (s : State) (tm now : Nat)
    (F : Funded s d fs) (sep : Separated fs.length) (budget : Budgeted s)
    (nf : now<2^48) (allowed : tm≤now) (forward : stored s .through≤now) :
    Funded (output c s tm now) d fs ∧ Budgeted (output c s tm now) ∧ stored (output c s tm now) .through=now := by
  obtain ⟨acc,bound,_,th⟩ := publicEffects c s tm now F.accounts sep budget nf allowed
  rw [max_eq_right forward] at th
  have total := funext (publicPaid c s tm now (stored s .through) F.accounts sep nf allowed forward rfl (fun _ => rfl))
  rw [total] at acc
  refine ⟨⟨?_,F.count⟩,bound,th⟩
  rw [th]; exact acc

structure Totals (s last : State) (d : Nat) (fs : List Funding) (start stop cutoff : Nat) (returns : Bool → Nat) : Prop where
  eligible : ∀ eth, vested d (min start cutoff) fs eth + returns eth = vested d (min stop cutoff) fs eth
  combined : ∀ eth, bucket last eth + returns eth + vested d start fs eth = bucket s eth + vested d stop fs eth

private theorem combine {before earned stale after b0 b1 bf rest final : Nat}
    (one : before+earned+stale=after) (b : b1=b0+stale) (tail : bf+rest+after=b1+final) :
    bf+(earned+rest)+before=b0+final := by omega
theorem history (fuel : Nat) (F : Funded s d fs) (sep : Separated fs.length) (budget : Budgeted s)
    (clock : stored s .through=start) (schedule : Schedule cutoff s start calls stop) :
    ∃ last e p, run fuel cutoff s calls=some (last,e,p) ∧ Funded last d fs ∧ Budgeted last ∧
      stored last .through=stop ∧ Totals s last d fs start stop cutoff (fun eth => if eth then e else p) := by
  induction schedule with
  | nil s t =>
    exact ⟨s,0,0,rfl,F,budget,clock,⟨by intro eth; simp,by intro eth; simp⟩⟩
  | @cons start s cs stop c forward nf fields free clone tail ih =>
    let now := nowAt c
    let tm := cutoffAt c cutoff
    let out := checkpointOutput c s cutoff
    let si := Release.entryState c s
    have allowed : tm≤now := Nat.min_le_left _ _
    have fwd : stored s .through≤now := clock ▸ forward
    have execute := call fuel c s tm now rfl fields free clone F.accounts sep budget nf allowed
    obtain ⟨funded,bounded,through⟩ := fundedCheckpoint c s tm now F sep budget nf allowed fwd
    obtain ⟨last,e,p,rest,final,finalBudget,lastAt,T⟩ := ih funded bounded through
    obtain ⟨_,_,delta,_⟩ := publicEffects c s tm now F.accounts sep budget nf allowed
    have atStart (eth : Bool) : vested d (stored s .through) fs eth=vested d start fs eth := clock ▸ rfl
    have eligible (eth : Bool) := cutoffAmount F.accounts start now cutoff forward clock atStart eth
    have sumAt (eth : Bool) : vested d start fs eth + earned s tm eth + staleCredit si tm now eth=vested d now fs eth := by
      have total := publicPaid c s tm now start F.accounts sep nf allowed forward clock atStart eth
      change vested d (stored s .through) fs eth+earned s tm eth+staleCredit si tm now eth=_ at total
      rwa [atStart] at total
    refine ⟨last,earned s tm true+e,earned s tm false+p,?_,final,finalBudget,lastAt,?_⟩
    · change (do
          let .returned next [.word x,.word y] ← SolidCore.Solidity.TypeCheck.CheckedContract.callTargetWithContext? (fuel+79) model
            (.name "checkpoint") c s [.word tm] | none
          let (z,u,v) ← run fuel cutoff next cs
          return (z,x+u,y+v))=_
      rw [execute]
      change (do let (z,u,v) ← run fuel cutoff out cs; return (z,earned s tm true+u,earned s tm false+v))=_
      rw [rest]; rfl
    · constructor
      · intro eth
        have first := eligible eth
        change vested d (min start cutoff) fs eth + earned s tm eth = vested d (min now cutoff) fs eth at first
        have next := T.eligible eth
        change vested d (min now cutoff) fs eth + (if eth then e else p)=_ at next
        cases eth <;> simp only [Bool.false_eq_true,if_false,if_true] at * <;> omega
      · intro eth
        cases eth
        · exact combine (sumAt false) (delta false) (T.combined false)
        · exact combine (sumAt true) (delta true) (T.combined true)
end Inv08.Checkpoint
