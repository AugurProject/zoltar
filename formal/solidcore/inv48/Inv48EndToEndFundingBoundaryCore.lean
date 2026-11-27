import Inv48EscrowCanonicalGetter
import Inv48RequestQuoteAudit
import Inv48WholeQuoteGenerated
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EndToEndFunding
open Inv48.EscrowPrefix Inv48.RequestQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- An open-world successful request has an actual successful external answer.
The payload is derived by the generated argument evaluator, not supplied. -/
theorem requestBoundary (n : Nat) (c : Context) (r final : Runtime)
    (id a b h e s sponsor bounty gas : Nat)
    (stmt : Stmt) (source : actualCall = some stmt)
    (trace : Interaction.Transcript)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (quoteTuple a b h e s))
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (ha : a<R) (hb : b<R) (hh : h<R) (hB : bounty<R) (hG : gas<R)
    (hp : c.sender<2^160) (hs : sponsor<2^160)
    (self : c.self<R) (construction : c.construction=false)
    (externalBoundary : c.selfDispatch? = none)
    (run : ExecutesOK (Stmt.eval (n+1) Inv48.Source.model.core.table c r stmt)
      trace (.normal final)) :
    ∃ (answer : CallResponse) (rest : Interaction.Transcript),
      trace = [⟨.external (snapshotWorld c r.state)
        (.call (buildCallRequest c .call c.self
          (calldata 2391489481 c.sender sponsor a b h bounty gas) 0 none)),answer⟩] ++ rest ∧
      answer.success = true ∧
      ExecutesOK (reply n Inv48.Source.model.core.table c r returns cleanups successBody
        (decodeCallResponse answer .call c.self
          (calldata 2391489481 c.sender sponsor a b h bounty gas) 0 none,
          adoptWorld answer.postWorld c r.state)) rest (.normal final) := by
  rw [checkedOperational n _ c r id a b h e s sponsor bounty gas stmt source
    ref mem S B G ha hb hh hB hG hp hs self construction] at run
  rw [Inv48.EscrowEntry.openDispatchRequest c r.state c.self _ _ externalBoundary] at run
  cases run with
  | request answer tail =>
    refine ⟨answer,_,rfl,?_,tail⟩
    exact replyNormalSuccess n _ c r final _ _ tail

end Inv48.EndToEndFunding
