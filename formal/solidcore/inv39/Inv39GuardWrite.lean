import Inv39GuardDecl
import Inv39RecoverExpr
open SolidCore.Solidity.Source
namespace Inv39.Auth

def rhsPost (c : Context) (r : Runtime) (q : Value × Runtime) :=
  q.2.locals=r.locals ∧ Fold.echo c r.state q.2.state

def assignResult (c : Context) (base : Runtime) (v : Value) (p : Except RevertData (ResolvedLValue × Runtime)) : SolI Result :=
  match p with
  | .ok (loc,rt) =>
    match loc.write c rt v with
    | .ok res => pure (.normal res)
    | .error err => pure (.reverted base err)
  | .error err => pure (.reverted base err)

theorem assignResolved {allow w c r mid} (dst : String) (v : Value) (hidden : w dst=false) (non : ¬aliases dst)
    (prior : Relative w c r mid) :
    Fold.Ensures (((LValue.var dst).resolveWithRuntime c mid).caught >>= assignResult c r v) (post allow w c r) := by
  apply Fold.bind (Q:=post allow w c r) (Fold.fromFrame (Frame.caught (lookupNormal c mid dst non prior.safe)))
  rintro (err|⟨loc,rt⟩) eq
  · exact Fold.pureValue (Result.reverted r _) _ trivial
  · change rt=mid ∧ loc=.local dst at eq; obtain ⟨rfl,rfl⟩ := eq
    simp only [assignResult,ResolvedLValue.write]
    split
    · rename_i out ok; split at ok
      · rename_i next write; cases ok
        exact Fold.pureValue (Result.normal _) _ (prior.trans (localWrite prior.safe hidden write))
      · contradiction
    · exact Fold.pureValue (Result.reverted r _) _ trivial

def evaluated (c : Context) (r : Runtime) (dst : String) (e : Expr) : SolI (Value × Runtime) :=
  if (LValue.var dst).wantsMemoryRefRhs r then e.evalMemoryRefPreserving c r else e.eval c r

theorem rhsAssigned {allow w c r} (dst : String) (e : Expr) (hidden : w dst=false) (non : ¬aliases dst)
    (safe : safeEnv r.locals) (read : Fold.Ensures (evaluated c r dst e) (rhsPost c r)) :
    Fold.Ensures ((evaluated c r dst e).caught >>= fun
       | .ok (v,mid) => ((LValue.var dst).resolveWithRuntime c mid).caught >>= assignResult c r v
       | .error err => pure (.reverted r err)) (post allow w c r) := by
  apply Fold.bind (Q:=post allow w c r) (Fold.caught read)
  rintro (err|⟨v,mid⟩) ok
  · exact Fold.pureValue (Result.reverted r _) _ trivial
  · exact assignResolved dst v hidden non (sameLocals ok.2 ok.1 safe)
end Inv39.Auth
