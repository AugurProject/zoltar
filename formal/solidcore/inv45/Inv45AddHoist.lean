import Inv45AddCross
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Add
def temporary (r : Runtime) (w : Nat) := r.withFrame [(temp,.word w)]
def magState (r : Runtime) (mag : Nat) := (temporary r mag).declareLocal "absoluteValue" (.word mag)
def tempArgs (r : Runtime) (v : Int) (result : Nat) :=
  r.withFrame [(magSlot,.word result),("_ic_arg_0",.int (Signed.word v))]
macro "store_add" : tactic => `(tactic|
  simp [temporary,tempArgs,magState,temp,magSlot,Runtime.assignNamedValuesRef?,Runtime.assignLocalRefAware?,
    Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.lookupLocal?,Runtime.withFrame,Runtime.declareLocal,
    LocalEnv.declare,LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
theorem fetchMagnitude (n : Nat) (c : Context) (r : Runtime) (v : Int) (V : Signed.inRange v)
    (found : r.lookupLocal? "value"=some (.int (Signed.word v))) :
    Stmt.eval (n+9) model.core.table c (temporary r 0) hoist.value=pure (.normal (temporary r v.natAbs)) := by
  let t := model.core.table
  let src := temporary r 0
  let init := src.pushScope.declareLocal "_ic_arg_0" (.int (Signed.word v))
  let args := tempArgs src v 0
  let fetched := tempArgs src v v.natAbs
  let copied := tempArgs (temporary r v.natAbs) v v.natAbs
  have E := intClean (readSignedLocal c src.pushScope "value" _ found) V
  have a := declareSigned (n+7) t "_ic_arg_0" (e:=Shapes.signedCast (varP "value")) E
  have b := Inv32FloorStart.zero (n+7) t c init magSlot
  have call := Shapes.absoluteCall n c args v "_ic_arg_0" [magSlot] V rfl
  have assigned : internalCallAssign args [magSlot] [.word v.natAbs]=pure (.normal fetched) := by
    dsimp [internalCallAssign,args,fetched,src];store_add
  have cap := Inv32Internal.capture (n+7) t c args fetched [magSlot] _ (call.trans assigned)
  have copy := Inv32Temps.copy (n+7) t c fetched copied temp magSlot 0 v.natAbs rfl rfl (by dsimp [fetched,copied,src];store_add)
  let body := [Stmt_varDecl intTy (lit "_ic_arg_0") (Option_some (Shapes.signedCast (varP "value"))),
    decl magSlot Option_none, Stmt_captureReturn (seq [lit magSlot]) (Stmt_internalCall (seq [lit magSlot]) (lit Shapes.absoluteKey)
      (seq [varP "_ic_arg_0"])), assign temp (varP magSlot)]
  have list : Stmt.evalList (n+8) t c src.pushScope (body.map Pattern.value)=pure (.normal copied) := by
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ a).trans ?_;refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ b).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ cap).trans ?_;refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ copy).trans ?_;change Stmt.evalList (n+8) t c copied []=_;rw [Stmt.evalList]
  change Stmt.eval (n+9) t c src (.block (body.map Pattern.value))=_
  rw [Stmt.eval];dsimp only;rw [list];rfl
end Inv45.Add
