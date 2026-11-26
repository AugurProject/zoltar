import Inv08ReleaseInternal
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv08.Checkpoint
abbrev a0 := "_ic_arg_0"
abbrev er := "_ret_release_0"
abbrev pr := "_ret_release_1"
abbrev tr := "_ret___library_CheckedCast_toUint48_0"
abbrev castKey := "__internal___library_CheckedCast_toUint48(uint256)#[SolidCore.Solidity.Ty.uint 256]"
def castBody := block [assign "value" (wvar "value"), Stmt_skip, block [
  Stmt_requireStmt (Expr_binary BinaryOp_le (wvar "value") (clean (num (2^48-1)))) (Option_some (lit "Timestamp exceeds uint48")),
  ret (Expiry.uint48 (wvar "value"))]]
def relCall := Preview.callCaptured Release.internalKey [er,pr] [a0]
def pay (varName en pn : String) := [Expiry.typed a0 (Expiry.w48 varName),decl er Option_none,decl pr Option_none,
  relCall,assign en (varP er),assign pn (varP pr)]
def eligibleCond := Expr_binary BinaryOp_gt (Expiry.w48 "eligibleThrough") (Expiry.clean48 (Expiry.refField "releasedThrough"))
def eligible := Stmt_ifElse eligibleCond (block (pay "eligibleThrough" "ethAmount" "repAmount")) Stmt_skip
def castClock := block [Expiry.typed a0 (clean Release.blockTime),decl tr Option_none,
  Preview.callCaptured castKey [tr] [a0],assign "_sol_hoist_0" (varP tr)]
def staleCond := Expr_binary BinaryOp_gt (clean Release.blockTime) (clean (Expiry.refField "releasedThrough"))
def staleBody := block ([decl "_sol_hoist_0" Option_none,castClock,
  Expiry.typed "#view540" (Expiry.uint48 (Expiry.uint48 (Expiry.w48 "_sol_hoist_0"))),decl "staleEth" Option_none,decl "staleRep" Option_none]++
  pay "#view540" "staleEth" "staleRep" ++ [ReleaseWrites.update BinaryOp_add "deferredEth" (varP "staleEth"),
    ReleaseWrites.update BinaryOp_add "deferredRep" (varP "staleRep")])
def stale := Stmt_ifElse staleCond staleBody Stmt_skip
def captured := Stmt_captureReturn (seq [lit "ethAmount",lit "repAmount"]) (block [eligible,stale])
def modifiers := block [Authority.callerGuard,Authority.initializedGuard,captured]
def nested := block [modifiers]
def body := block [assign "eligibleThrough" (Expiry.w48 "eligibleThrough"),Stmt_skip,Stmt_skip,nested]
theorem publicPresent : (model.core.findFunctionByName? "checkpoint").isSome := by native_decide
def fn := (model.core.findFunctionByName? "checkpoint").get publicPresent
theorem bodyFromSource : fn.body=body.value := body.sound _ (by native_decide)
theorem params : fn.params=[Inv32Library.decl (.word "eligibleThrough")] :=
  Inv32Library.sound fn.params [.word "eligibleThrough"] (by native_decide)
theorem results : fn.returns=[Inv32Library.decl (.word "ethAmount"),Inv32Library.decl (.word "repAmount")] :=
  Inv32Library.sound fn.returns [.word "ethAmount",.word "repAmount"] (by native_decide)
def frame (tm a b : Nat) : Frame := [("eligibleThrough",.word tm),("ethAmount",.word a),("repAmount",.word b)]
theorem initial (tm : Nat) : fn.initialFrame? [.word tm]=some (frame tm 0 0) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [params,results]; simp [BindingDecl.bindArgs?,BindingDecl.bindArg?,BindingDecl.defaultBinding,Inv32Library.decl,Ty.coerceValue?,Ty.defaultValue,frame]
theorem dispatch (tm : Nat) : model.core.resolveCallFunction? (.name "checkpoint") [.word tm]=some fn := by
  have found : model.core.findFunctionByName? "checkpoint"=some fn := (Option.some_get publicPresent).symm
  obtain ⟨nameOk,before,after,decomp,skip⟩ := List.find?_eq_some_iff_append.mp found
  apply List.find?_eq_some_iff_append.mpr
  refine ⟨?_,before,after,decomp,?_⟩
  · simp only [nameOk,initial,Option.isSome_some,Bool.true_and]
  · intro f mem; have absent := skip f mem; simp_all
end Inv08.Checkpoint
