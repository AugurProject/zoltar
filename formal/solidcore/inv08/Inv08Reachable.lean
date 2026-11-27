import Inv08Deposits
import Inv08TakeDeferred
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.FundingHistory

theorem onWithdrawal (n : Nat) (c : Context) (v : ValidState s d fs) (auth : Authorized c s)
    (sep : Separated fs.length) (returned : StateCall (n+43) "takeDeferred" c s []=some (.returned out outputs)) :
    ValidState out d fs := by
  have fit (eth : Bool) : stored s (Checkpoint.deferredField eth)<R :=
    lt_trans (lt_of_le_of_lt (Nat.le_add_left _ _) (v.budget eth)) (by decide)
  have run := TakeDeferred.generated n c s auth.fields auth.free auth.clone
    (v.funded.accounts.duration.symm ▸ v.funded.accounts.positive) (fit true) (fit false)
  apply carryResult run returned
  have clock := (TakeDeferred.fieldAfter c s .through).trans (TakeDeferred.clock s)
  refine ⟨⟨?_,v.funded.count⟩,fun eth => ?_⟩
  · rw [clock]; exact TakeDeferred.accounts c v.funded.accounts sep
  · rw [TakeDeferred.fieldAfter,TakeDeferred.fieldAfter,TakeDeferred.outside,TakeDeferred.cleared,Nat.add_zero]
    exact lt_of_le_of_lt (Nat.le_add_right _ _) (v.budget eth)

/-- Histories start at fresh clone storage and record the actual result of each mutating public call.
The deposit list retains the original amounts even when a same-second deposit reuses a storage ID. -/
inductive Reachable (n d : Nat) : State → List Funding → List Funding → Prop
  | initialize (c : Context) (tm : Nat) (dep : Deployer c tm d) (sep : Separated 0)
      (run : StateCall (n+42) "initialize" c (Initialize.fresh c.sender) [.word tm,.word d]=some (.returned s [])) :
      Reachable n d s [] []
  | fund (before : Reachable n d s raw fs) (c : Context) (auth : Authorized c s)
      (h : Step d f fs gs) (sep : Separated gs.length) (clock : EnvWord.blockTimestamp.eval c=f.time)
      (now : stored s .through=f.time) (ends : f.time+d<2^48) (nonzero : f.eth≠0 ∨ f.rep≠0)
      (room : ∀ eth,stored s (outstandingField eth)+(stream eth f).budget+stored s (deferredField eth)<2^128)
      (run : StateCall (n+44) "addStream" c s [.word f.eth,.word f.rep]=some (.returned t [])) :
      Reachable n d t (raw++[f]) gs
  | release (before : Reachable n d s raw fs) (c : Context) (auth : Authorized c s) (tm : Nat)
      (time : tm<Packed.B) (fwd : stored s .through≤tm) (current : tm≤EnvWord.blockTimestamp.eval c)
      (sep : Separated fs.length) (run : StateCall (n+70) "release" c s [.word tm]=some (.returned t outputs)) :
      Reachable n d t raw fs
  | checkpoint (before : Reachable n d s raw fs) (c : Context) (auth : Authorized c s) (now tm : Nat)
      (clock : EnvWord.blockTimestamp.eval c=now) (sep : Separated fs.length)
      (time : now<Packed.B) (allowed : tm≤now) (forward : stored s .through≤now)
      (run : StateCall (n+79) "checkpoint" c s [.word tm]=some (.returned t outputs)) :
      Reachable n d t raw fs
  | withdraw (before : Reachable n d s raw fs) (c : Context) (auth : Authorized c s) (sep : Separated fs.length)
      (run : StateCall (n+43) "takeDeferred" c s []=some (.returned t outputs)) :
      Reachable n d t raw fs

end Inv08.FundingHistory
