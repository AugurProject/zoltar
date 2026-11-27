import Inv32Actions
open SolidCore.Solidity.Source
namespace Inv48.Minima
@[simp] theorem lookupDeclare (r : Runtime) (name query : String) (v : Value) :
    (r.declareLocal name v).lookupLocal? query = if query=name then some v else r.lookupLocal? query := by
  by_cases eq : name=query
  all_goals cases h : r.locals <;> simp [eq,Ne.symm,Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,h]
@[simp] theorem lookupPush (r : Runtime) (query : String) :
    r.pushScope.lookupLocal? query=r.lookupLocal? query := rfl
end Inv48.Minima
