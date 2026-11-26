import Inv08ReachableFunding
import Inv08Reachable
open SolidCore.Solidity.Source
namespace Inv08.FundingHistory

theorem represented (trace : Reachable n d s raw fs) : ValidState s d fs ∧ Groups d raw fs := by
  induction trace with
  | «initialize» c tm dep sep run => exact ⟨onInitialize n c tm d dep sep run,.nil⟩
  | fund before c auth step sep clock now ends nonzero room run ih =>
    exact ⟨onFunding n c ih.1 auth step sep clock now ends nonzero room run,.fund ih.2 step⟩
  | release before c auth tm time fwd current sep run ih =>
    exact ⟨onRelease n c ih.1 auth tm time fwd current sep run,ih.2⟩
  | checkpoint before c auth now tm clock sep time allowed forward run ih =>
    exact ⟨onCheckpoint n c ih.1 auth now tm clock sep time allowed forward run,ih.2⟩
  | withdraw before c auth sep run ih => exact ⟨onWithdrawal n c ih.1 auth sep run,ih.2⟩

theorem startHistory (n : Nat) (c : Context) (tm d : Nat) (dep : Deployer c tm d) (sep : Separated 0) :
    Reachable n d (Initialize.output c (Initialize.fresh c.sender) tm d) [] [] :=
  .initialize c tm dep sep (Initialize.generated n c tm d dep.free dep.fields dep.imms dep.sender dep.time dep.duration
    dep.positive dep.current dep.size dep.binding)

theorem appendDeposit (trace : Reachable n d s raw fs) (c : Context) (auth : Authorized c s)
    (clock : EnvWord.blockTimestamp.eval c=f.time) (now : stored s .through=f.time) (ends : f.time+d<2^48)
    (nonzero : f.eth≠0 ∨ f.rep≠0)
    (room : ∀ eth,stored s (outstandingField eth)+(stream eth f).budget+stored s (deferredField eth)<2^128)
    (sep : ∀ gs, Step d f fs gs → Separated gs.length) :
    ∃ out gs, Reachable n d out (raw++[f]) gs := by
  have v := (represented trace).1
  obtain ⟨gs,step⟩ := nextStep d f fs v.funded.accounts.positive
  let entry := Release.entryState c s
  have init : Funded entry d fs := fundedTransport s entry rfl v.funded
  obtain ⟨dom,stages,pf,_,_⟩ := fundingDomain init.accounts step init.count now ends nonzero room (sep gs step)
  have run := AddStream.generated n c s f (record d fs) auth.free auth.clone auth.fields clock dom stages pf
  exact ⟨_,gs,.fund trace c auth step (sep gs step) clock now ends nonzero room run⟩

end Inv08.FundingHistory
