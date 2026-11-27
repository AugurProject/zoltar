import Inv08StorageTransport
import Inv08Release
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv08.FundingHistory

structure Call where
  context : Source.Context
  timestamp : Nat

/-- Every invocation is dispatched through the generated public contract. -/
def run (fuel : Nat) (s : State) : List Call → Option (State × Nat × Nat)
  | [] => some (s,0,0)
  | x::xs => do
    let .returned next [.word eth,.word rep] ← TypeCheck.CheckedContract.callTargetWithContext? (fuel+70) model
      (.name "release") x.context s [.word x.timestamp] | none
    let (last,restEth,restRep) ← run fuel next xs
    return (last,eth+restEth,rep+restRep)

inductive Legal : State → Nat → List Call → Nat → Prop
  | nil (s : State) (t : Nat) : Legal s t [] t
  | cons (x : Call) (forward : start≤x.timestamp) (time : x.timestamp<Packed.B)
      (current : x.timestamp≤EnvWord.blockTimestamp.eval x.context)
      (fields : x.context.storageFields=model.core.context.storageFields) (free : x.context.value=0)
      (clone : Authority.Clone x.context (Release.baseRuntime x.context s))
      (tail : Legal (Release.outputState x.context s x.timestamp) x.timestamp xs stop) :
      Legal s start (x::xs) stop

theorem publicRun (fuel : Nat) (H : Accounts s d fs paid) (sep : Separated fs.length)
    (schedule : Legal s start calls stop) (startAt : stored s .through ≤ start)
    (initialPaid : ∀ eth, paid eth=vested d start fs eth) :
    ∃ final e r, run fuel s calls = some (final,e,r) ∧
      paid true+e=vested d stop fs true ∧ paid false+r=vested d stop fs false ∧
      Accounts final d fs (vested d stop fs) := by
  induction schedule generalizing paid with
  | nil s t =>
    refine ⟨s,0,0,rfl,?_,?_,?_⟩
    · simpa using initialPaid true
    · simpa using initialPaid false
    · rwa [←funext initialPaid]
  | @cons start s xs stop x forward time current fields free clone tail ih =>
    have fwd := startAt.trans forward
    have readyNow := ready H x.timestamp time fwd
    have executes := Release.release fuel x.context s x.timestamp fields free clone readyNow current
    have lifetime := lifetimeAfter H x.timestamp fwd
    have represented := transport _ _ (Release.outputStorage x.context s x.timestamp)
      (afterRelease H x.timestamp time fwd sep)
    have packed := Release.clock s x.timestamp time readyNow.toReady.qFit
    have through : stored (Release.outputState x.context s x.timestamp) .through = x.timestamp := by
      apply Eq.trans (scalarCongr _ (Release.post s x.timestamp) .through ?_) packed.1
      simp [State.loadSlot,Release.outputStorage]
    obtain ⟨final,e,r,rest,ethEq,repEq,accounts⟩ := ih represented (Nat.le_of_eq through) lifetime
    refine ⟨final,Preview.payout s x.timestamp true+e,Preview.payout s x.timestamp false+r,?_,?_,?_,accounts⟩
    · simp [run,executes,rest]
    · exact (Nat.add_assoc _ _ _).symm.trans ethEq
    · exact (Nat.add_assoc _ _ _).symm.trans repEq
end Inv08.FundingHistory
