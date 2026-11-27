import Inv48InitialTransferPublic
import Inv48EndToEndFundingRounded
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.InitialTransfer
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.EscrowEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
theorem quotedAtRequestSite (k : Nat) (parent c : Context) (state : State)
    (final : Runtime) (sponsor a p halt bounty gas oracle collateral : Nat)
    (site : Runtime) (id : Nat)
    (funding : Inv48.WholeQuote.HasFunding site id a p)
    (hw : a < 2^256) (ha : (Inv48.QuoteExec.repAmount a p) < 2^256) (hh : halt < 2^256)
    (hb : bounty < 2^256) (hg : gas < 2^32) (hp : parent.sender < 2^160)
    (senderBound : c.sender < 2^256) (selfBound : c.self < 2^256) (zeroValue : c.value = 0)
    (notConstruction : c.construction = false)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b∈universeBytes,b<256) (ct : ∀ b∈token,b<256)
    (code : (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope).state.envAccountCode c c.self =
      Inv48.CloneRead.runtimeCode implementation universeBytes token)
    (O : (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).loadImmutableField c "collateralToken" = .ok (.word collateral))
    (openWorld : c.selfDispatch? = none)
    (tree : SolI Result) (trace : Interaction.Transcript)
    (binding : fn.evalBodyEntry (k+42+5) Inv48.Source.model.core.table c state
      (arguments parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas) = some tree)
    (run : ExecutesOK tree trace (.normal final)) :
    (∃ h e s, site.lookupLocal? "quote" = some (.memoryRef id) ∧
      site.loadMemory? id = some (Inv48.QuoteMemory.tuple a
        (Inv03.ceilQuot (a*p) (10^18)) h e s)) ∧
    c.sender = c.self ∧ Contains c parent.sender
      (Inv03.ceilQuot (a*p) (10^18)) (Inv48.CloneRead.decode token) trace := by
  obtain ⟨ref,h,e,s,mem⟩ := funding
  constructor
  · exact ⟨h,e,s,ref,mem⟩
  · exact canonicalTranscript k c state final parent.sender sponsor a
      (Inv48.QuoteExec.repAmount a p) halt bounty gas oracle collateral
      hw ha hh hb hg hp senderBound selfBound zeroValue notConstruction
      implementation universeBytes token hi hu ht cu ct code O C openWorld tree trace binding run

/-- Existing generated transport and public request boundary remain the owners
of quote computation and exact request calldata respectively. -/
def registeredQuoteTransport := Inv48.QuoteTransport.generatedTransport
def publicRequestBoundary := Inv48.EndToEndFunding.roundedRequestBoundary

end Inv48.InitialTransfer
