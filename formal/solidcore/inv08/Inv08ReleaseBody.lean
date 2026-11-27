import Inv08ReleaseAssignments
import Inv08AuthorityShapes
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv08.Release
def blockTime : Pattern Expr :=
  ⟨.env .blockTimestamp,fun | .env .blockTimestamp => true | _ => false,by intro x h; dsimp only at h; split at h <;> simp_all⟩
def validTime := Stmt_requireStmt (Expr_binary BinaryOp_le (wvar "until") (clean blockTime))
  (Option_some (lit "Future fee checkpoint"))
abbrev a0 := "_ic_arg_0"
abbrev re := "_ret__preview_0"
abbrev rp := "_ret__preview_1"
abbrev ri := "_ret__preview_2"
def quote := block [Expiry.typed a0 (Expiry.w48 "until"),decl re Option_none,decl rp Option_none,decl ri Option_none,
  Preview.callCaptured Preview.key [re,rp,ri] [a0],assign "ethAmount" (varP re),assign "repAmount" (varP rp),assign "expiredId" (varP ri)]
def writes := [credit true,credit false,subtract true,subtract false,ReleaseWrites.record48 "releasedThrough" "until",
  ReleaseWrites.record48 "releasedExpiryId" "expiredId"]
def runBody := block ([validTime,decl "expiredId" Option_none,quote]++writes)
def captured := Stmt_captureReturn (seq [lit "ethAmount",lit "repAmount"]) runBody
def modifiers := block [Authority.callerGuard,Authority.initializedGuard,captured]
def nested := block [modifiers]
def body := block [assign "until" (Expiry.w48 "until"),Stmt_skip,Stmt_skip,nested]
theorem publicPresent : (model.core.findFunctionByName? "release").isSome := by native_decide
def fn := (model.core.findFunctionByName? "release").get publicPresent
theorem bodyFromSource : fn.body=body.value := body.sound _ (by native_decide)
theorem params : fn.params=[Inv32Library.decl (.word "until")] :=
  Inv32Library.sound fn.params [.word "until"] (by native_decide)
theorem results : fn.returns=[Inv32Library.decl (.word "ethAmount"),Inv32Library.decl (.word "repAmount")] :=
  Inv32Library.sound fn.returns [.word "ethAmount",.word "repAmount"] (by native_decide)
def frame (tm a b : Nat) : Frame := [("until",.word tm),("ethAmount",.word a),("repAmount",.word b)]
theorem initial (tm : Nat) : fn.initialFrame? [.word tm]=some (frame tm 0 0) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [params,results]; simp [BindingDecl.bindArgs?,BindingDecl.bindArg?,BindingDecl.defaultBinding,Inv32Library.decl,Ty.coerceValue?,Ty.defaultValue,frame]
theorem dispatch (tm : Nat) : model.core.resolveCallFunction? (.name "release") [.word tm]=some fn := by
  have found : model.core.findFunctionByName? "release"=some fn := (Option.some_get publicPresent).symm
  obtain ⟨nameOk,before,after,decomp,skip⟩ := List.find?_eq_some_iff_append.mp found
  apply List.find?_eq_some_iff_append.mpr
  refine ⟨?_,before,after,decomp,?_⟩
  · simp only [nameOk,initial,Option.isSome_some,Bool.true_and]
  · intro f mem; have absent := skip f mem; simp_all
end Inv08.Release
