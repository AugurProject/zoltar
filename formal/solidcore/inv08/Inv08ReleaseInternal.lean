import Inv08Release
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Release
def internalKey := "__internal_release(uint48)#[SolidCore.Solidity.Ty.uint 48]"
theorem internalLink : Inv32Library.LinkAt model.core.table internalKey [.word "until"]
    [.word "ethAmount",.word "repAmount"] body.value :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Inv32Shapes.Option_some body).sound _ (by native_decide))
def afterCall (c : Context) (r : Runtime) (tm : Nat) : Runtime :=
  {Authority.post c r with state:=post r.state tm}

private theorem pb {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
theorem internal (n : Nat) (c : Context) (r : Runtime) (arg : String) (targets : List String) (tm : Nat)
    (found : r.lookupLocal? arg=some (.word tm)) (fields : c.storageFields=model.core.context.storageFields)
    (clone : Authority.Clone c r) (h : Ready r.state tm) (current : tm≤EnvWord.blockTimestamp.eval c) :
    Stmt.eval (n+71) model.core.table c r (.internalCall targets internalKey [.var arg]) =
      internalCallAssign (afterCall c r tm) targets [.word (Preview.payout r.state tm true),.word (Preview.payout r.state tm false)] := by
  obtain ⟨fn,link,ps,rs,bd⟩ := internalLink
  let inner := {c with checked:=true}
  let empty := {r with locals:=[]}
  let src := empty.withFrame (frame tm 0 0)
  let e := Preview.payout r.state tm true
  let p := Preview.payout r.state tm false
  let dst := {(Authority.post inner empty).withFrame (frame tm e p) with state:=post r.state tm}
  have enter : internalCallEnter? fn [.word tm] r=some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,empty,src,Runtime.withFrame]
  have args : Expr.evalRefArgList c r [.var arg] = pure ([.word tm],r) := by
    change Expr.evalRefArgListFuel (_+1) c r _ = _
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,Inv32ProductCall.wordArg _ _ _ _ found,pb]
  have auth := Authority.authorized (n+27) inner (guarded empty tm 0 0) clone
  have init := Authority.initialized (n+27) inner (Authority.post inner (guarded empty tm 0 0)) fields h.duration
  have E := execute n inner empty tm fields h current (clockWord inner) auth init
  change Stmt.eval _ _ _ src body.value = pure (.normal dst) at E
  rw [←bd] at E
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args link enter E]
  have ret : collectReturnBindingsRef fn.returns dst = .ok [.word e,.word p] := by
    rw [rs]
    simp [collectReturnBindingsRef,collectReturnBindingsRef.collect,Inv32Library.decl,dst,Runtime.lookupLocal?,
      Runtime.withFrame,frame,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
      Ty.coerceValue?,Bind.bind,Except.bind]
  simp only [internalCallFinish,ret]
  rfl
end Inv08.Release
