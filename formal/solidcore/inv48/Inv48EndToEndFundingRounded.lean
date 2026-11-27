import Inv48EndToEndFundingChild
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EndToEndFunding
open Inv48.EscrowPrefix Inv48.RequestQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
theorem roundedRequestBoundary (n : Nat) (c : Context) (r final : Runtime)
    (id a p sponsor bounty gas : Nat)
    (stmt : Stmt) (source : actualCall = some stmt)
    (trace : Interaction.Transcript)
    (funding : Inv48.WholeQuote.HasFunding r id a p)
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (ha : a<R) (hb : Inv48.QuoteExec.repAmount a p<R)
    (haltBound : ∀ h e s, r.loadMemory? id = some (quoteTuple a (Inv48.QuoteExec.repAmount a p) h e s) → h<R) (hB : bounty<R) (hG : gas<R)
    (hp : c.sender<2^160) (hs : sponsor<2^160)
    (self : c.self<R) (construction : c.construction=false)
    (externalBoundary : c.selfDispatch? = none)
    (run : ExecutesOK (Stmt.eval (n+1) Inv48.Source.model.core.table c r stmt)
      trace (.normal final)) :
    ∃ (h : Nat) (answer : CallResponse) (rest : Interaction.Transcript),
      trace = [⟨.external (snapshotWorld c r.state)
        (.call (buildCallRequest c .call c.self
          (calldata 2391489481 c.sender sponsor a (Inv48.QuoteExec.repAmount a p) h bounty gas) 0 none)),answer⟩] ++ rest ∧
      answer.success = true := by
  obtain ⟨ref,h,e,s,mem⟩ := funding
  obtain ⟨answer,rest,traceEq,success,_⟩ := requestBoundary n c r final id a
    (Inv48.QuoteExec.repAmount a p) h e s sponsor bounty gas stmt source trace
    ref mem S B G ha hb (haltBound h e s mem) hB hG hp hs self construction externalBoundary run
  exact ⟨h,answer,rest,traceEq,success⟩
end Inv48.EndToEndFunding
