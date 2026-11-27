import Inv48LiquidationVerifiedReplay
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace LiquidationBody
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
abbrev t := LiquidationLibrary.table
abbrev q := LiquidationLibrary.quotient
abbrev clean := Inv32FloorFastPath.cleanParam
abbrev requireU := LiquidationLibrary.uncertaintyRequire
def outer : List Stmt := match actualLiquidationLibraryBody with
  | .block ss => ss
  | _ => []
def inner : List Stmt := match (outer : List Stmt)[3]? with
  | some (Stmt.block ss) => ss
  | _ => []
def hoist : List Stmt := match (inner : List Stmt)[2]? with
  | some (Stmt.block ss) => ss
  | _ => []
def setup := hoist.take 4
def nested := ((hoist : List Stmt)[4]?).getD .skip
def copy := ((hoist : List Stmt)[5]?).getD .skip
def ret := ((inner : List Stmt)[3]?).getD .skip
theorem bodyShape : actualLiquidationLibraryBody =
    .block [clean "price",clean "uncertainty",.skip,
      .block [requireU,.varDecl .uint256 "_sol_hoist_0" none,
        .block (setup ++ [nested,copy]),ret]] := rfl
def entry (r : Runtime) (p u : Nat) (tail : Frame) : Runtime :=
  r.withFrame ([("price",.word p),("uncertainty",.word u)] ++ tail)

macro "locals_simp" : tactic => `(tactic|
  simp [entry,Runtime.withFrame,Runtime.pushScope,Runtime.popScope,Runtime.declareLocal,
    Runtime.lookupLocal?,Runtime.assignLocal?,LocalEnv.lookup?,LocalEnv.assign?,
    LocalEnv.declare,Frame.lookup?,Frame.assign?,Value.coerceLike?])

private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl
end LiquidationBody
