import Inv08ReleaseAssignments
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Release

set_option maxHeartbeats 1800000 in
theorem effects (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (tm : Nat) (h : Ready r.state tm)
    (fields : c.storageFields=model.core.context.storageFields) (stampLocal : r.lookupLocal? "until"=some (.word tm))
    (expired : r.lookupLocal? "expiredId"=some (.word (Preview.q r.state tm)))
    (paid : ∀ eth, r.lookupLocal? (amountLocal eth)=some (.word (Preview.payout r.state tm eth))) :
    Stmt.evalList (n+1) t c r ReleaseWrites.expected.value =
      pure (.normal {r with state:=post r.state tm}) := by
  let s := r.state
  let r1 := {r with state:=ethCredited s tm}
  let r2 := {r with state:=repCredited s tm}
  let r3 := {r with state:=ethDebited s tm}
  let r4 := {r with state:=repDebited s tm}
  let r5 := {r with state:=timestamped s tm}
  have fit (eth : Bool) := lt_of_le_of_lt (h.funded eth) (h.word eth)
  have first := creditRuns n t c r true _ fields (paid true) (fit true) (cursorFit h true)
  have second : (credit false).value.eval (n+1) t c r1 = pure (.normal r2) := by
    have keep := repUnaffected s tm
    have next : stored r1.state (cursorField false)+Preview.payout s tm false*stored r1.state .duration=cursor s tm false := by
      change stored (ethCredited s tm) .repCursor+_*stored (ethCredited s tm) .duration=_
      rw [keep.1,keep.2]; rfl
    have ev := creditRuns n t c r1 false (Preview.payout s tm false) fields (paid false) (fit false) (by rw [next]; exact cursorFit h false)
    dsimp only at ev
    rw [next] at ev
    exact ev
  have third : (subtract true).value.eval (n+1) t c r2 = pure (.normal r3) := by
    have keep : stored r2.state (outstandingField true)=stored s (outstandingField true) := ethAvailable _ _
    have ev := subtractRuns n t c r2 true (Preview.payout s tm true) fields (paid true) (by rw [keep]; exact h.funded true) (by rw [keep]; exact h.word true)
    dsimp only at ev
    rw [keep] at ev
    exact ev
  have fourth : (subtract false).value.eval (n+1) t c r3 = pure (.normal r4) := by
    have keep : stored r3.state (outstandingField false)=stored s (outstandingField false) := repAvailable _ _
    have ev := subtractRuns n t c r3 false (Preview.payout s tm false) fields (paid false) (by rw [keep]; exact h.funded false) (by rw [keep]; exact h.word false)
    dsimp only at ev
    rw [keep] at ev
    exact ev
  have stamp := recordRuns n t c r4 .through "until" tm fields stampLocal h.time
  have checkpoint := recordRuns n t c r5 .settled "expiredId" (Preview.q s tm) fields expired h.qFit
  exact (Inv32FloorStart.seqStep _ _ _ _ r1 _ _ first).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ second).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ third).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ fourth).trans
    ((Inv32FloorStart.seqStep _ _ _ _ r5 _ _ stamp).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] checkpoint).trans (by rw [Stmt.evalList]; rfl))))))
end Inv08.Release
