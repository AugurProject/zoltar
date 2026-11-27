import Inv48QuoteContinuationIdentityCapture
import Inv48CapturedEscrowArgsFrame
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CapturedEscrowArgs
open Inv48.RequestGuards Inv48.QuoteTransport Inv48.EscrowPrefix Inv48.RequestDispatch Inv48.ActualSiteGuardJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

def rest (s p a b g : Nat) : LocalEnv := [] :: Inv48.RequestPrologue.requestFrame s p a b g :: []

theorem aliasPop (n : Nat) (c : Context) (post origin : Runtime)
    (s p a b g old id : Nat)
    (frame : origin.locals = [(hoist,.memoryRef old)] :: rest s p a b g) :
    (Stmt.eval (n+2) Inv48.Source.model.core.table c
      (Inv48.ObservedQuoteJoin.captured post origin p a b id) aliasP.value >>= pop) =
      pure (Result.normal (aliased post [] (rest s p a b g) id)) := by
  have caller : Inv48.ObservedQuoteJoin.captured post origin p a b id =
      captured post [] (rest s p a b g) p a b id old := by
    simp only [Inv48.ObservedQuoteJoin.captured,captured,saved,frame]
  rw [caller]
  change (Stmt.eval ((n+1)+1) _ c _ (.assign (.var hoist) (.var ret)) >>= pop) = _
  rw [aliasStep]
  rfl

theorem fieldsAtPrep (n m : Nat) (c : Context) (post pending site : Runtime)
    (s p a b g id h e fee : Nat) (st pt : Interaction.Transcript)
    (mem : post.loadMemory? id = some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p) h e fee))
    (he : e<2^256) (hf : fee<2^256)
    (writes : ExecutesOK (Stmt.evalList (n+1) Inv48.Source.model.core.table c
      (aliased post [] (rest s p a b g) id) ((Inv48.RequestQuote.actual.drop 7).take 5)) st (.normal pending))
    (prep : ExecutesOK (Stmt.evalList (m+1) Inv48.Source.model.core.table c pending.pushScope actualPrep) pt (.normal site)) :
    site = callPrep pending ∧
    site.lookupLocal? "quote" = some (.memoryRef id) ∧
    site.loadMemory? id = some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p) h e fee) ∧
    site.lookupLocal? "sponsor" = some (.word s) ∧
    site.lookupLocal? "bountyAttoEth" = some (.word b) ∧
    site.lookupLocal? "callbackGasLimit" = some (.word g) := by
  have S : (declared post [] (rest s p a b g) id).lookupLocal? "sponsor" = some (.word s) := by rfl
  obtain ⟨⟨state,rfl⟩,rfl,ref,heap,_⟩ := recoverSite n m _ c post pending site [] (rest s p a b g)
    id a p h e fee s st pt mem S he hf writes prep
  exact ⟨rfl,ref,heap,rfl,rfl,rfl⟩

end Inv48.CapturedEscrowArgs
