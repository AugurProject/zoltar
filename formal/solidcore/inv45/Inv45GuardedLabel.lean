import Inv45GetterJoin
import Inv45PeelGuard
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public

def guardedLabel := Source.Stmt.block [readTicksInto "#read1610",positiveDecl,checkEquality,
  .ifElse (.var "#cond1619") joinBlock .skip]
def lastPair (body : Source.Stmt) : Option (List Source.Stmt) := do
  let (_,yes,_) ← firstDecision body
  let .block xs := yes | none
  pure ((xs.reverse.take 2).reverse)
theorem actualLabelSuffix : lastPair getter.body=some [.varDecl .uint256 "sum" (some tickSum),guardedLabel] := by
  rw [getterSource];rfl

private theorem accessible (r : Runtime) (n : Nat) (name : String)
    (a : name≠"#read1610") (b : name≠"#cond1619") :
    (readyForLabel (r.declareLocal "sum" (.word n)) n).lookupLocal? name =
      (r.declareLocal "sum" (.word n)).lookupLocal? name := by
  simp [readyForLabel,Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,
    LocalEnv.lookup?,Frame.lookup?,a,b,Ne.symm a,Ne.symm b]

theorem sumThroughReturn (fuel : Nat) (c : Context) (r : Runtime) (q n k : Nat) (lo hi : Int) (unit : List Nat)
    (fields : c.storageFields=model.core.storageFields)
    (look : r.lookupLocal? "questionId"=some (.word q))
    (first : r.lookupLocal? "firstPart"=some (.word (n-k))) (second : r.lookupLocal? "secondPart"=some (.word k))
    (ticks : wordBitRange 96 120 (r.state.loadSlot (questionMemberSlot q 2))=n)
    (low : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 3))=Signed.word lo)
    (high : wordBitRange 0 256 (r.state.loadSlot (questionMemberSlot q 4))=Signed.word hi)
    (bytes : r.state.loadStorageBytesAt (questionMemberSlot q 5)=.ok unit)
    (N : n<2^120) (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi)
    (pos : 0<n) (valid : k≤n) (len : unit.length<R) (sane : ∀ch∈unit,ch<256)
    (cap : c.memoryAllocationLimit?=none) :
    ∃ after out, Decimal.Holds after (Text.label (Scale.display lo (hi-lo).toNat n k) unit n (Scale.tag (hi-lo).toNat n k)) out ∧
      Source.Stmt.evalList (fuel+112) model.core.table c r [.varDecl .uint256 "sum" (some tickSum),guardedLabel]=pure (.returned after [out]) := by
  let init := r.declareLocal "sum" (.word n)
  let ready := readyForLabel init n
  have prev (name : String) (h : name≠"sum") : init.lookupLocal? name=r.lookupLocal? name := by
    cases E:r.locals <;> simp [init,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,E,h,Ne.symm h]
  have tag (name : String) (a : name≠"#read1610") (b : name≠"#cond1619") (d : name≠"sum") :
      ready.lookupLocal? name=r.lookupLocal? name := (accessible _ _ _ a b).trans (prev _ d)
  obtain ⟨_,after,out,holds,run⟩ := validSumJoin fuel c ready q n k lo hi unit fields
    ((tag _ (by decide) (by decide) (by decide)).trans look) ((tag _ (by decide) (by decide) (by decide)).trans first)
    ((tag _ (by decide) (by decide) (by decide)).trans second) ticks low high bytes N L H rise pos valid len sane cap
  have branch := (trueLocal (fuel+110) c ready joinBlock .skip rfl).trans run
  have sumId : init.lookupLocal? "sum"=some (.word n) := by cases e:r.locals <;> simp [init,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,e]
  have peel := peelValidGuard [.ifElse (.var "#cond1619") joinBlock .skip] (fuel+107) c init q n fields ((prev _ (by decide)).trans look) sumId pos N ticks
  have ret := Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ branch
  have blockRun := Inv32FloorFastPath.blockReturned (fuel+111) model.core.table c init after _ [out] (peel.trans ret)
  have sum := sumDeclaration (fuel+111) c r n k N valid first second
  refine ⟨after.popScope,out,?_,?_⟩
  · cases holds with
    | direct => exact .direct
    | ref h cell => exact .ref h cell
  · rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ sum]
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ blockRun
#print axioms sumThroughReturn
end Inv45.Public
