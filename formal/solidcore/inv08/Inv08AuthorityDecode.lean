import Inv08AuthorityLoop
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv03.Bodies Inv32FloorStart
namespace Inv08.Authority
theorem sizeTest (c : Context) (r : Runtime) (size : (bytes c r).length=65) (off : r.lookupLocal? "offset"=some (.word 45)) :
    lengthTest.value.eval c r = pure (.word 1,r) := by
  have read := sizeRead c r
  rw [size] at read
  have L := ReleaseQuote.readClean read (by decide : 65<R)
  have O := ReleaseQuote.readClean (localReads c r "offset" 45 off) (by decide : 45<R)
  have sum := double (ReleaseQuote.binary O (literal c r 20 (by decide)) .add (by intro h; cases h) (by intro h; cases h)
    (Inv40.addWords c.checked 45 20 (by decide))) (by decide)
  exact ReleaseQuote.binary L sum .eq (by intro h; cases h) (by intro h; cases h)
    (Inv32WideGuards.eqWord _ 65 65 (by decide) (by decide)) _ (Nat.le_succ _)

theorem memorySetup (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) :
    let start := (withOffset r 0 45).pushScope
    Stmt.eval (n+1) t c start memoryDecl.value = pure (.normal (withCode c r 0)) := by
  let st := (withOffset r 0 45).pushScope
  have ref : Expr.memoryRefOrValue c st selfCode.value = pure (none,some (.bytes (bytes c r)),st) := by
    change Expr.memoryRefOrValueFuel 4 c st (.envBytesLookup .accountCode .self) = _
    rw [Expr.memoryRefOrValueFuel]
    change (do let (v,next) ← Expr.evalFuel 3 c st selfCode.value
               pure (none,some v,next)) = _
    rw [selfRead]; rfl
    all_goals simp
  change Stmt.eval _ t c st (.memoryVarDecl .bytesCalldata "#extcode" (some selfCode.value)) = _
  rw [Stmt.eval]
  dsimp only
  rw [ref]
  change (match st.declareMemoryLocal .bytesCalldata "#extcode" (.bytes (bytes c r)) with
          | some next => (pure (.normal next) : SolI Result)
          | none => pure (.reverted st RevertData.typeMismatch)) = _
  have allocated : st.declareMemoryLocal .bytesCalldata "#extcode" (.bytes (bytes c r)) = some (withCode c r 0) := by
    simp [Runtime.declareMemoryLocal,Ty.coerceValue?,Runtime.memoryStoredValue,Bind.bind,Option.bind]
    rfl
  rw [allocated]

theorem decodeBlock (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (size : (bytes c r).length=65) :
    let val := prefixWord (bytes c r) 20
    Stmt.eval (n+25) t c (withOffset r 0 45) codeBlock.value = pure (.normal (withOffset (post c r) val 45)) := by
  let val := prefixWord (bytes c r) 20
  let doneR := working c r 0 20 val
  let finish := working c r val 20 val
  have mem := memorySetup (n+23) t c r
  have zeroIndex := Inv32Hoist.declEval (n+23) t c (withCode c r 0) "#extindex" .uint256 (.word 0) 0
    (literal _ _ _ (by decide) _ (Nat.le_succ _)) (by rfl)
  have zeroWord := Inv32Hoist.declEval (n+23) t c (counted c r 0 0) "#extword" .uint256 (.word 0) 0
    (literal _ _ _ (by decide) _ (Nat.le_succ _)) (by rfl)
  have clear := Inv32Writes.constant (n+23) t c (working c r 0 0 0) (working c r 0 0 0) "#extword" 0 0 rfl
    (by write_clone; rfl)
  have run : Stmt.eval (n+24) t c (working c r 0 0 0) (.whileLoop more.value iteration.value) = pure (.normal doneR) := by
    rw [Stmt.eval]; exact loop n 20 0 t c r rfl size
  have read := castBits (localReads c doneR "#extword" val rfl) 160 (by decide) (by decide) (prefixBound (bytes c r) 20)
  have store := Inv32Assign.scalarCast (n+23) t c doneR finish "binding" 0 val .uintCast 160 _ rfl
    (read _ (Nat.le_succ _)) (by dsimp [doneR,finish]; write_clone)
  have endList : Stmt.evalList (n+24) t c finish []=pure (.normal finish) := by rw [Stmt.evalList]
  apply Inv32Hoist.block (n+24) t c _ finish
  exact (seqStep _ _ _ _ _ _ _ mem).trans ((seqStep _ _ _ _ _ _ _ zeroIndex).trans
    ((seqStep _ _ _ _ _ _ _ zeroWord).trans ((seqStep _ _ _ _ _ _ _ clear).trans
      ((seqStep _ _ _ _ _ _ _ run).trans ((seqStep _ _ _ _ _ _ _ store).trans endList)))))

theorem decode (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (size : (bytes c r).length=65) :
    Stmt.eval (n+27) t c (boundEntry r 0) boundBody.value =
      pure (.normal (boundEntry (post c r) (prefixWord (bytes c r) 20))) := by
  let src := boundEntry r 0
  let val := prefixWord (bytes c r) 20
  let inner := src.pushScope.pushScope
  let rt := withOffset r 0 45
  let doneR := withOffset (post c r) val 45
  have z := Inv32FloorStart.zero (n+24) t c inner "offset"
  have setOffset := Inv32Writes.constant (n+23) t c (withOffset r 0 0) rt "offset" 0 45 rfl
    (by dsimp [rt]; write_clone; rfl)
  have select := Inv32Blocks.branch (n+24) t c (withOffset r 0 0) (.word 1) initOffset.value initOffset.value true (by rfl)
  have check := Inv32QuoteGuard.requireEval (n+24) t c rt _ true "Capital module requires a clone" (sizeTest c rt size rfl)
  have finish := decodeBlock n t c r size
  have nilDone : Stmt.evalList (n+25) t c doneR []=pure (.normal doneR) := by rw [Stmt.evalList]
  have main := Inv32Hoist.block (n+25) t c src.pushScope doneR _ ((seqStep _ _ _ _ _ _ _ z).trans
    ((seqStep _ _ _ _ _ _ _ (select.trans setOffset)).trans ((seqStep _ _ _ _ _ _ _ check).trans
      ((seqStep _ _ _ _ _ _ _ finish).trans nilDone))))
  have skip : Stmt.eval (n+26) t c src.pushScope .skip = pure (.normal src.pushScope) := by rw [Stmt.eval]
  have endList : Stmt.evalList (n+26) t c doneR.popScope [] = pure (.normal doneR.popScope) := by rw [Stmt.evalList]
  exact Inv32Hoist.block (n+26) t c src doneR.popScope _ ((seqStep _ _ _ _ _ _ _ skip).trans
    ((seqStep _ _ _ _ _ _ _ main).trans endList))
end Inv08.Authority
