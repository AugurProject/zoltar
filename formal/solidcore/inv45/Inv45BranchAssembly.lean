import Inv45AppendNormal
import Inv45ValidPrefix
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public
theorem exactScalarTail : validPrefixTail = [.varDecl .uint256 "sum" (some tickSum),guardedLabel] := by rfl
theorem finishScalarBranch (fuel : Nat) (c : Context) (r : Runtime) (q n k : Nat) (lo hi : Int) (unit : List Nat)
    (fields : c.storageFields=model.core.storageFields)
    (look : r.lookupLocal? "questionId"=some (.word q))
    (scalar : r.state.loadSlot (labelsSlot q)=0)
    (ticks : wordBitRange 96 120 (r.state.loadSlot (questionMemberSlot q 2))=n)
    (low : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 3))=Signed.word lo)
    (high : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 4))=Signed.word hi)
    (bytes : r.state.loadStorageBytesAt (questionMemberSlot q 5)=.ok unit)
    (N : n<2^120) (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi)
    (pos : 0<n) (valid : k≤n) (len : unit.length<R) (sane : ∀ch∈unit,ch<256)
    (cap : c.memoryAllocationLimit?=none)
    (decode : Source.Stmt.evalList (fuel+112) model.core.table c r.pushScope validPrefix =
       pure (.normal (validPrefixRuntime r n k))) :
    ∃ guard yes no after out, firstDecision getter.body=some (guard,yes,no) ∧
      Decimal.Holds after (Text.label (Scale.display lo (hi-lo).toNat n k) unit n (Scale.tag (hi-lo).toNat n k)) out ∧
      Source.Stmt.eval (fuel+114) model.core.table c r (.ifElse guard yes no)=pure (.returned after [out]) := by
  obtain ⟨no,src,_⟩ := generatedValidPrefixShape
  have id : (validPrefixRuntime r n k).lookupLocal? "questionId"=some (.word q) := by
    simpa [validPrefixRuntime,Runtime.lookupLocal?,Runtime.pushScope,Runtime.declareLocal,
      LocalEnv.lookup?,LocalEnv.declare,Frame.lookup?] using look
  obtain ⟨after,out,holds,run⟩ := sumThroughReturn fuel c (validPrefixRuntime r n k) q n k lo hi unit fields id rfl rfl
    ticks low high bytes N L H rise pos valid len sane cap
  rw [←exactScalarTail] at run
  have allSteps := (appendNormal _ _ _ _ validPrefixTail _ _ decode).trans run
  have blockRun := Inv32FloorFastPath.blockReturned _ _ _ _ _ _ _ allSteps
  refine ⟨_,_,no,after.popScope,out,src,?_,(selectScalar _ _ _ _ _ _ _ fields look scalar).trans blockRun⟩
  cases holds with
  | direct => exact .direct
  | ref h cell => exact .ref h cell
#print axioms finishScalarBranch
end Inv45.Public
