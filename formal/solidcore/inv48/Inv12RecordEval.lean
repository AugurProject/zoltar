import Inv12ChooseBody
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv12.Owner

def recordKey : Expr := .castOp .uintCleanup 248 (.var "source")
def recordTarget : LValue := .index (.storageIndex "choices" recordKey) .caller
def recordOutcome : Expr := .castOp .uintCleanup 256 (.castOp .uintCast 256 (.var "outcome"))
def recordValue : Expr := .tuple [recordOutcome,.word 1]

theorem keyRead (c : Context) (r : Runtime) (source : Nat) (hi : source<2^248)
    (lookup : r.lookupLocal? "source"=some (.word source)) : Inv40.Reads c r recordKey source := by
  have fit : source<Inv32Division.R := lt_trans hi (by decide)
  have cast : uintCleanup? c.checked 248 (.word source)=.ok (.word source) := by
    norm_num at hi
    simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,
      show SolidCore.Solidity.Shared.norm source=source from Nat.mod_eq_of_lt fit,Nat.not_le_of_gt hi,Nat.mod_eq_of_lt hi,Bind.bind,Except.bind]
  intro fuel enough
  change 2≤fuel at enough
  obtain ⟨k,rfl⟩:=Nat.exists_eq_add_of_le' enough
  unfold recordKey
  rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ lookup]
  change (do let v ← liftM (uintCleanup? c.checked 248 (.word source));pure (v,r) : SolI (Value × Runtime))=_
  rw [cast];rfl

theorem ownerLocate (c : Context) (r : Runtime) (source : Nat) (hi : source<2^248)
    (lookup : r.lookupLocal? "source"=some (.word source)) :
    recordTarget.resolveWithRuntime c r=pure (.storagePath "choices" [.word source,.word c.sender],r) := by
  change Expr.resolveLValueFuel 8 c r (.index (.storageIndex "choices" recordKey) .caller)=_
  have inside (k : Nat) : Expr.resolveLValueFuel (k+3) c r (.storageIndex "choices" recordKey)=
      pure (.storageIndex "choices" (.word source),r) := by
    simp [Expr.resolveLValueFuel,keyRead c r source hi lookup (k+2) (by change 2≤k+2;omega),Inv08.Authority.bindPure]
  simp only [Expr.resolveLValueFuel.eq_def, Nat.reduceAdd, keyRead c r source hi lookup 6 (by decide),Inv08.Authority.bindPure]
  rfl

theorem outcomeRead (c : Context) (r : Runtime) (o : Nat) (fit : o<Inv32Division.R)
    (look : r.lookupLocal? "outcome"=some (.word o)) : Inv40.Reads c r recordOutcome o :=
  Inv08.ReleaseQuote.readClean (Inv08.Authority.castBits (Inv08.localReads _ _ _ _ look) 256 (by decide) (by decide) fit) fit

theorem tupleRead (c : Context) (r : Runtime) (o : Nat) (fit : o<Inv32Division.R)
    (look : r.lookupLocal? "outcome"=some (.word o)) :
    Expr.eval c r recordValue=pure (.tuple [.word o,.word 1],r) := by
  change Expr.evalFuel 9 c r (.tuple [recordOutcome,.word 1])=_
  have head : Expr.memoryRefOrValueFuel 7 c r recordOutcome=pure (none,some (.word o),r) := by
    change (do let (v,next) ← Expr.evalFuel 6 c r recordOutcome;pure (none,some v,next))=_
    rw [outcomeRead c r o fit look 6 (by decide)];rfl
  change (do let (vs,next) ← Expr.evalTupleListFuel 8 c r [recordOutcome,.word 1]; pure (Value.tuple vs,next))=_
  simp only [Expr.evalTupleListFuel.eq_def,head,Nat.reduceAdd,Inv08.Authority.bindPure]
  rfl
end Inv12.Owner
