import Inv48EscrowDecodeWords
import Inv48ChildExtractionInputs
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowDecode
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

theorem decoded (payer sponsor a amount halt bounty gas : Nat)
    (hp : payer < 2^160) (hs : sponsor < 2^160)
    (hw : a < 2^256) (ha : amount < 2^256) (hh : halt < 2^256)
    (hb : bounty < 2^256) (hg : gas < 2^32) :
    ABI.decodeFunctionArgs? Inv48.EscrowEntry.fn
      ((Inv48.RequestQuote.calldata 2391489481 payer sponsor a amount halt bounty gas).drop ABI.selectorBytes) =
      .ok (Inv48.EscrowEntry.arguments payer sponsor a amount halt bounty gas) := by
  have hpw : payer < 2^256 := lt_trans hp (by decide)
  have hsw : sponsor < 2^256 := lt_trans hs (by decide)
  have hgw : gas < 2^256 := lt_trans hg (by decide)
  have addr (v : Nat) (fit : v < 2^160) : ABI.addressFits v = true := by
    exact decide_eq_true (lt_of_le_of_lt (Nat.mod_le _ _) fit)
  have read (i v : Nat) (item : [payer,sponsor,a,amount,halt,bounty,gas][i]? = some v)
      (fit : v < 2^256) :
      ABI.readWord? (Inv48.RequestQuote.payload payer sponsor a amount halt bounty gas) (32*i) = some v :=
    readWords _ i v item fit
  have r0 := read 0 payer rfl hpw
  simp only [Nat.mul_zero] at r0
  have r1 := read 1 sponsor rfl hsw
  have r2 := read 2 a rfl hw
  have r3 := read 3 amount rfl ha
  have r4 := read 4 halt rfl hh
  have r5 := read 5 bounty rfl hb
  have r6 := read 6 gas rfl hgw
  have len : (Inv48.RequestQuote.payload payer sponsor a amount halt bounty gas).length = 224 :=
    wordsLength _
  have drop : (Inv48.RequestQuote.calldata 2391489481 payer sponsor a amount halt bounty gas).drop ABI.selectorBytes =
      Inv48.RequestQuote.payload payer sponsor a amount halt bounty gas := by
    unfold Inv48.RequestQuote.calldata
    rw [show ABI.selectorBytes = (wordToBytesBE selectorBytes 2391489481).length from
      (Inv48.Minima.wordLength _ _).symm, List.drop_left]
  have uint (bits x : Nat) (pos : 0 < bits) (width : bits ≤ 256)
      (word : x < 2^256) (bound : x < 2^bits) :
      AbiCleanup.accepts (.uint bits) (.word x) = true := by
    have norm : SolidCore.Solidity.Shared.norm x = x := by
      change x % (2^256) = x
      exact Nat.mod_eq_of_lt word
    simp [AbiCleanup.accepts, norm, pos, width, bound]
  rw [drop]
  simp [ABI.decodeFunctionArgs?, Inv48.EscrowEntry.metadata.1, cleanups,
    Inv48.EscrowEntry.params, Inv48.EscrowEntry.arguments,
    ABI.AbiCleanup.decodeLazy, ABI.decodeArgsWith?, ABI.decodeArgsAux?, ABI.decodeValueAt?,
    ABI.decodeValueAtWithFuel?, ABI.Ty.abiDecodeFuel, ABI.Ty.listAbiHeadWords?, ABI.Ty.abiHeadWords?,
    ABI.Ty.isDynamicAbi, ABI.Ty.staticAbiHeadWords?, ABI.abiArgOpt, ABI.wordBytes,
    len, r0,r1,r2,r3,r4,r5,r6, addr payer hp, addr sponsor hs,
    AbiCleanups.lazyParamValues, AbiCleanup.lazyParamValue,
    uint 256 a (by decide) (by decide) hw hw,
    uint 256 amount (by decide) (by decide) ha ha,
    uint 256 halt (by decide) (by decide) hh hh,
    uint 256 bounty (by decide) (by decide) hb hb,
    uint 32 gas (by decide) (by decide) hgw hg,
    Bind.bind, Except.bind, Option.bind, Pure.pure, Except.pure]

 theorem canonical (payer sponsor a p halt bounty gas : Nat)
    (hp : payer < 2^160) (hs : sponsor < 2^160)
    (hw : a < 2^256) (ha : Inv48.QuoteExec.repAmount a p < 2^256) (hh : halt < 2^256)
    (hb : bounty < 2^256) (hg : gas < 2^32) :
    Inv48.ChildExtraction.Canonical
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas)
      (Inv48.EscrowEntry.arguments payer sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas) :=
  ⟨Inv48.ChildExtraction.requestSelector _ _ _ _ _ _ _, decoded _ _ _ _ _ _ _ hp hs hw ha hh hb hg⟩

theorem sufficient (fuel budget : Nat) (rows : ScriptedResponder) (c : Context) (state : State)
    (payer sponsor a p halt bounty gas : Nat) (enough : 47 ≤ fuel)
    (hp : payer < 2^160) (hs : sponsor < 2^160)
    (hw : a < 2^256) (ha : Inv48.QuoteExec.repAmount a p < 2^256) (hh : halt < 2^256)
    (hb : bounty < 2^256) (hg : gas < 2^32)
    (served : Inv48.NestedResponder.Served c state
      (Inv48.RequestQuote.calldata 2391489481 payer sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) fuel budget rows) :
    Inv48.PublicInvariant.SuccessfulBodyExtraction c state payer sponsor a p halt bounty gas
      fuel budget rows served :=
  Inv48.ChildExtraction.sufficient fuel budget rows c state payer sponsor a p halt bounty gas enough
    (canonical payer sponsor a p halt bounty gas hp hs hw ha hh hb hg) served

#print axioms decoded
#print axioms canonical
end Inv48.EscrowDecode
