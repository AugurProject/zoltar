import Inv39WrapperTerms
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
def tempNames : List Source.Expr := [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2",.var "_ic_arg_3",.var "_ic_arg_4",
  .var "_ic_arg_5",.var "_ic_arg_6",.var "_ic_arg_7",.var "_ic_arg_8",.var "_ic_arg_9"]
def tempValues (h : Nat) (p : Payment) : List Source.Value := [.fixedBytes 32 h,.word p.from_,.word p.to_,.word p.value,.word p.validAfter,
  .word p.validBefore,.fixedBytes 32 p.nonce,.word p.v,.fixedBytes 32 p.r,.fixedBytes 32 p.s]
def innerFrame (h : Nat) (p : Payment) := ("typeHash", Source.Value.fixedBytes 32 h)::signedFrame p
theorem byteArg (c : Context) (r : Runtime) (k : String) (v : Nat) (ref : r.lookupLocal? k=some (.fixedBytes 32 v)) :
    Expr.evalRefArg c r (.var k)=pure (.fixedBytes 32 v,r) := by
  simp only [Expr.evalRefArg,Runtime.lookupStorageBase?,Runtime.lookupMemoryRef?,ref]; exact bytesVar 1 _ _ _ _ ref
theorem actualArgs (c : Context) (r : Runtime) (bs : List Source.Byte) (p : Payment) :
    let ready := temps r.pushScope bs p
    Expr.evalRefArgList c ready tempNames=pure (tempValues (hashOf bs) p,ready) := by
  let ready := temps r.pushScope bs p
  have pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
  change Expr.evalRefArgListFuel 21 c ready tempNames=_
  simp only [tempNames,Expr.evalRefArgListFuel]
  simp only [byteArg c ready "_ic_arg_0" (hashOf bs) rfl,
    Inv32ProductCall.wordArg c ready "_ic_arg_1" (p.from_) rfl,
    Inv32ProductCall.wordArg c ready "_ic_arg_2" (p.to_) rfl,
    Inv32ProductCall.wordArg c ready "_ic_arg_3" (p.value) rfl,
    Inv32ProductCall.wordArg c ready "_ic_arg_4" (p.validAfter) rfl,
    Inv32ProductCall.wordArg c ready "_ic_arg_5" (p.validBefore) rfl,
    byteArg c ready "_ic_arg_6" (p.nonce) rfl,
    Inv32ProductCall.wordArg c ready "_ic_arg_7" (p.v) rfl,
    byteArg c ready "_ic_arg_8" (p.r) rfl,
    byteArg c ready "_ic_arg_9" (p.s) rfl,pb]; rfl
theorem signedEnter (fn : InternalFunction) (r : Runtime) (h : Nat) (p : Payment) (w : Widths p) (clean : Shared.norm h=h)
    (ps : fn.params=paramsWithHash) (rs : fn.returns=[]) :
    internalCallEnter? fn (tempValues h p) r=some ({r with locals:=[innerFrame h p]},r.locals) := by
  unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
  rw [ps,rs]
  simp [paramsWithHash,signedParams,tempValues,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,Ty.coerceValue?,
    innerFrame,signedFrame,normWord,clean,show Shared.norm p.nonce=p.nonce from Nat.mod_eq_of_lt w.nonce,
    show Shared.norm p.r=p.r from Nat.mod_eq_of_lt w.r,show Shared.norm p.s=p.s from Nat.mod_eq_of_lt w.s]
theorem innerSafe (r : Runtime) (h : Nat) (p : Payment) : safeEnv ({r with locals:=[innerFrame h p]} : Runtime).locals := by
  intro f hf; obtain rfl := List.mem_singleton.mp hf
  rintro ⟨name,v⟩ mem; apply Or.inr; simp [innerFrame,signedFrame] at mem
  rcases mem with ⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩ <;> trivial
theorem innerSeen (r : Runtime) (h : Nat) (p : Payment) : Seen p {r with locals:=[innerFrame h p]} := by constructor <;> rfl
end Inv39.Auth
