import Inv48ChildExtractionCore
open SolidCore.Solidity.Source
namespace Inv48.ChildExtraction
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

private theorem wordLength (n value : Nat) : (wordToBytesBE n value).length = n := by
  induction n generalizing value with
  | zero => rfl
  | succ n ih => simp [wordToBytesBE,ih]

theorem requestSelector (payer sponsor a amount halt bounty gas : Nat) :
    ABI.readSelector? (Inv48.RequestQuote.calldata 2391489481 payer sponsor a amount halt bounty gas) =
      some 2391489481 := by
  have read : ABI.readBytes?
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a amount halt bounty gas) 0 4 =
      some (wordToBytesBE 4 2391489481) := by
    unfold ABI.readBytes? Inv48.RequestQuote.calldata
    simp only [List.drop_zero,List.length_append,wordLength,selectorBytes]
    rw [if_pos (by omega)]
    rw [List.take_append_of_le_length (by rw [wordLength])]
    rw [List.take_of_length_le (by rw [wordLength])]
    rfl
  unfold ABI.readSelector? ABI.selectorBytes
  rw [read]
  rfl

/-- The only remaining canonical-input obligation is the actual ABI decoder
identity on the exact payload. It must not be inferred from ABI success. -/
theorem canonicalFromDecoder (payer sponsor a p halt bounty gas : Nat)
    (decoded : ABI.decodeFunctionArgs? Inv48.EscrowEntry.fn
      ((Inv48.RequestQuote.calldata 2391489481 payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas).drop ABI.selectorBytes) =
      .ok (Inv48.EscrowEntry.arguments payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas)) :
    Canonical (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
      (Inv48.QuoteExec.repAmount a p) halt bounty gas)
      (Inv48.EscrowEntry.arguments payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) :=
  ⟨requestSelector _ _ _ _ _ _ _,decoded⟩

#print axioms requestSelector
end Inv48.ChildExtraction
