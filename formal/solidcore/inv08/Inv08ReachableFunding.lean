import Inv08ReachableCalls
import Inv08AddStreamPublic
namespace Inv08.FundingHistory
open SolidCore.Solidity.Source

theorem onFunding (n : Nat) (c : Context) (v : ValidState s d xs) (auth : Authorized c s)
    (h : Step d f xs ys) (sep : Separated ys.length) (clock : EnvWord.blockTimestamp.eval c=f.time)
    (now : stored s .through=f.time) (ends : f.time+d<2^48) (nonzero : f.eth≠0 ∨ f.rep≠0)
    (room : ∀ eth,stored s (outstandingField eth)+(stream eth f).budget+stored s (deferredField eth)<2^128)
    (returned : StateCall (n+44) "addStream" c s [.word f.eth,.word f.rep]=some (.returned out [])) :
    ValidState out d ys := by
  let entry := Release.entryState c s
  have init : Funded entry d xs := fundedTransport s entry rfl v.funded
  obtain ⟨dom,stages,pf,_,_⟩ := fundingDomain init.accounts h init.count now ends nonzero room sep
  have run := AddStream.generated n c s f (record d xs) auth.free auth.clone auth.fields clock dom stages pf
  apply carryResult run returned
  let post := AddStream.post entry f (record d xs)
  have same : (AddStream.outputState c s f (record d xs)).storage=post.storage := rfl
  obtain ⟨F,B⟩ := fundedAdd init h sep now ends nonzero room
  exact ⟨fundedTransport post _ same F,budgetTransport post _ same B⟩
end Inv08.FundingHistory
