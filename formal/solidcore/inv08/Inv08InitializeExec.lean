import Inv08InitializeAuthority
import Inv08Genesis
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv08.Initialize

theorem execute (n : Nat) (c : Context) (r : Runtime) (tm d : Nat) (tf : tm<2^48) (df : d<2^48)
    (pos : 0<d) (fields : c.storageFields=model.core.context.storageFields)
    (zero : stored r.state .duration=0) (current : tm≤EnvWord.blockTimestamp.eval c)
    (fit : c.sender<R) (imm : r.loadImmutableField c "initializer"=pure (.word c.sender))
    (size : (Authority.bytes c r).length=65) (nz : Authority.prefixWord (Authority.bytes c r) 20≠0) :
    body.value.eval (n+42) model.core.table c (r.withFrame (frame tm d)) =
      pure (.normal {(Authority.post c r).withFrame (frame tm d) with state:=FundingHistory.initializeStorage r.state tm d}) := by
  let t := model.core.table
  let src := r.withFrame (frame tm d)
  let w := src.pushScope.pushScope
  let a := Authority.post c w
  let mid := {a with state:=a.state.storeFieldWord Field.duration.field d}
  let dst := {mid with state:=mid.state.storeFieldWord Field.through.field tm}
  have P := deployerOK (n+39) c w fit imm
  have L := ledgerOK n c w size nz
  have E := emptyOK (n+39) c a fields zero
  have T := timeOK (n+39) t c a tm current (Release.clockWord c) rfl
  have D := positiveOK (n+39) c a d df pos rfl
  have W := Release.recordRuns (n+39) t c a .duration "vestingDuration" d fields rfl df
  have C := Release.recordRuns (n+39) t c mid .through "timestamp" tm fields rfl tf
  have last : Stmt.evalList (n+40) t c dst [] = pure (.normal dst) := by rw [Stmt.evalList]
  have done := (seqStep _ _ _ _ _ _ _ P).trans ((seqStep _ _ _ _ _ _ _ L).trans
    ((seqStep _ _ _ _ _ _ _ E).trans ((seqStep _ _ _ _ _ _ _ T).trans
    ((seqStep _ _ _ _ _ _ _ D).trans ((seqStep _ _ _ _ _ _ _ W).trans
    ((seqStep _ _ _ _ _ _ _ C).trans last))))))
  have inner := Inv32Hoist.block (n+40) t c src.pushScope dst _ done
  have pTm := Inv32Assign.scalarCast (n+40) t c src.pushScope src.pushScope "timestamp" tm tm _ _ _ rfl
    (Expiry.local48 c src.pushScope "timestamp" tm tf rfl _ (Nat.le_succ _))
    (by dsimp [src,frame]; release_write)
  have pD := Inv32Assign.scalarCast (n+40) t c src.pushScope src.pushScope "vestingDuration" d d _ _ _ rfl
    (Expiry.local48 c src.pushScope "vestingDuration" d df rfl _ (Nat.le_succ _))
    (by dsimp [src,frame]; release_write)
  apply Inv32Hoist.block (n+41) t c src dst.popScope _
  exact (seqStep _ _ _ _ _ _ _ pTm).trans ((seqStep _ _ _ _ _ _ _ pD).trans
    ((seqStep _ _ _ _ _ _ [] inner).trans (by rw [Stmt.evalList])))
end Inv08.Initialize
