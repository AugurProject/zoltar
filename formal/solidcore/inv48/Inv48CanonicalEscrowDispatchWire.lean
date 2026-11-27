import Inv48CanonicalEscrowDispatchCut
import Inv48ExposureHeapBytes
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CanonicalEscrowDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem calldataWire (selector payer sponsor a amount halt bounty gas : Nat) :
    byteArrayToBytes (bytesToByteArray
      (Inv48.RequestQuote.calldata selector payer sponsor a amount halt bounty gas)) =
      Inv48.RequestQuote.calldata selector payer sponsor a amount halt bounty gas := by
  have nb (v : Nat) : normByte (normByte v) = normByte v := by
    simp [normByte,SolidCore.Solidity.Shared.Account.byte]
  have wb (n v : Nat) : (wordToBytesBE n v).map normByte = wordToBytesBE n v := by
    induction n generalizing v with
    | zero => rfl
    | succ n ih => simp [wordToBytesBE,List.map_append,ih,nb]
  have clean : (Inv48.RequestQuote.calldata selector payer sponsor a amount halt bounty gas).map normByte =
      Inv48.RequestQuote.calldata selector payer sponsor a amount halt bounty gas := by
    simp [Inv48.RequestQuote.calldata,Inv48.RequestQuote.payload,List.map_append,
      List.flatMap_cons,List.flatMap_nil,wb]
  have round (bs : List Byte) : byteArrayToBytes (bytesToByteArray bs) = bs.map normByte := by
    simp only [byteArrayToBytes,Inv48.ExposureHeap.byteList_data,bytesToByteArray,List.map_map]
    apply List.map_congr_left
    intro x hx
    simp [normByte,SolidCore.Solidity.Shared.Account.byte]
  rw [round,clean]

theorem recognizesCalldata (s : Schedule) (c : Context)
    (payer sponsor a amount halt bounty gas : Nat)
    (address : wordToAddress c.self = wordToAddress s.environment.self) :
    recognizes s (buildCallRequest c .call c.self
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a amount halt bounty gas) 0 none) := by
  unfold recognizes
  simp only [buildCallRequest,lowLevelKindToCallKind,calldataWire,address]
  exact ⟨True.intro,True.intro,True.intro,True.intro,Inv48.ChildExtraction.requestSelector _ _ _ _ _ _ _,True.intro⟩

/-- The served wire child is the typed canonical escrow child. Both address and
payer coherence refer to the scheduled environment, never a chosen suspension. -/
theorem canonicalTransfer (s : Schedule) (c : Context) (state : State)
    (sponsor a p halt bounty gas : Nat)
    (payer : s.environment.sender = c.sender)
    (child : Inv48.NestedResponder.Served s.environment
      (inputState s (snapshotWorld c state))
      (byteArrayToBytes (buildCallRequest c .call c.self
        (Inv48.RequestQuote.calldata 2391489481 c.sender sponsor a
          (Inv48.QuoteExec.repAmount a p) halt bounty gas) 0 none).calldata)
      s.fuel s.childBudget s.childRows)
    (success : child.result.success = true) (sponsorFits : sponsor < 2^160) :
    ∃ canonical : Inv48.NestedResponder.Served s.environment
      (inputState s (snapshotWorld c state))
      (Inv48.RequestQuote.calldata 2391489481 s.environment.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas)
      s.fuel s.childBudget s.childRows,
      canonical.result = child.result ∧
      canonical.nested.observed.trace = child.nested.observed.trace ∧
      Inv48.SingleTransferClosed.Transfer canonical ∧
      Inv48.PublicTokenDelta.TransferBoundary canonical := by
  have wire : byteArrayToBytes (buildCallRequest c .call c.self
      (Inv48.RequestQuote.calldata 2391489481 c.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) 0 none).calldata =
      Inv48.RequestQuote.calldata 2391489481 s.environment.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas := by
    simp only [buildCallRequest,calldataWire,payer]
  obtain ⟨canonical,_,result,sameTrace,transfer,boundary⟩ := transferOfWire s (snapshotWorld c state) _
    sponsor a p halt bounty gas wire child success sponsorFits
  exact ⟨canonical,result,sameTrace,transfer,boundary⟩
/-- Transfer closure at the recovered cut, using the same policy match obtained
from the original observation. No wire equality is a caller premise. -/
theorem successfulCanonicalCut (schedule : Schedule) (c : Context) (site : Runtime)
    (sponsor a p halt bounty gas replyFuel : Nat)
    (next : Result → SolI Result) (trace : Interaction.Transcript) (out : Result)
    (address : wordToAddress c.self = wordToAddress schedule.environment.self)
    (payer : schedule.environment.sender = c.sender)
    (sponsorFits : sponsor < 2^160)
    (openWorld : c.selfDispatch? = none)
    (run : Interaction.Executes
      ((selfDispatchCall c site.state .call c.self
        (Inv48.RequestQuote.calldata 2391489481 c.sender sponsor a
          (Inv48.QuoteExec.repAmount a p) halt bounty gas) 0 none >>=
        Inv48.RequestQuote.reply replyFuel Inv48.Source.model.core.table c site
          Inv48.RequestQuote.returns Inv48.RequestQuote.cleanups Inv48.RequestQuote.successBody) >>= next)
      trace (.ok out))
    (aligned : Inv48.ObservedEscrowResponder.Matches (policy schedule) trace)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (next (.reverted mid err)) rest (.ok out)) :
    ∃ child, serve schedule (snapshotWorld c site.state)
      (buildCallRequest c .call c.self
        (Inv48.RequestQuote.calldata 2391489481 c.sender sponsor a
          (Inv48.QuoteExec.repAmount a p) halt bounty gas) 0 none) = some child ∧
      child.result.success = true ∧
      (∃ rest, trace = ⟨Inv48.ObservedEscrowResponder.query c site.state
        (Inv48.RequestQuote.calldata 2391489481 c.sender sponsor a
          (Inv48.QuoteExec.repAmount a p) halt bounty gas),
        Inv48.NestedResponder.response schedule.environment
          (inputState schedule (snapshotWorld c site.state)) child.result⟩ :: rest) ∧
      ∃ canonical : Inv48.NestedResponder.Served schedule.environment
        (inputState schedule (snapshotWorld c site.state))
        (Inv48.RequestQuote.calldata 2391489481 schedule.environment.sender sponsor a
          (Inv48.QuoteExec.repAmount a p) halt bounty gas)
        schedule.fuel schedule.childBudget schedule.childRows,
        canonical.result = child.result ∧
        canonical.nested.observed.trace = child.nested.observed.trace ∧
        Inv48.SingleTransferClosed.Transfer canonical ∧
        Inv48.PublicTokenDelta.TransferBoundary canonical := by
  obtain ⟨child,computed,success,rest,event⟩ := successfulCut schedule c site _ replyFuel next trace out
    openWorld (recognizesCalldata schedule c _ _ _ _ _ _ _ address) run aligned reject
  exact ⟨child,computed,success,⟨rest,event⟩,
    canonicalTransfer schedule c site.state sponsor a p halt bounty gas payer child success sponsorFits⟩
end Inv48.CanonicalEscrowDispatch
