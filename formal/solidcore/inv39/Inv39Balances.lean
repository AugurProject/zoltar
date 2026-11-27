import Inv39History
namespace Inv39
abbrev Balances := List (Nat × Nat)
def balance (addr : Nat) (balances : Balances) := ((balances.filter fun p => p.1 == addr).map Prod.snd).sum
def total (balances : Balances) := (balances.map Prod.snd).sum
def other (addr : Nat) (balances : Balances) := balances.filter fun p => p.1 != addr
def setBalance (addr value : Nat) (balances : Balances) := (addr,value) :: other addr balances
theorem splitTotal (addr : Nat) (balances : Balances) :
    total balances = balance addr balances + total (other addr balances) := by
  induction balances with
  | nil => rfl
  | cons p tail ih =>
    by_cases atAddr : p.1 = addr <;>
      simp [balance,total,other,atAddr] at ih ⊢ <;> omega
theorem balanceLE (addr : Nat) (balances : Balances) : balance addr balances ≤ total balances := by
  have h := splitTotal addr balances
  omega
theorem balanceSet (addr v query : Nat) (b : Balances) :
    balance query (setBalance addr v b) = if query = addr then v else balance query b := by
  induction b with
  | nil => by_cases h : query=addr <;> simp_all [balance,setBalance,other,Ne.symm]
  | cons p bs ih =>
    by_cases h : query=addr <;> by_cases o : p.1=addr <;> by_cases q : p.1=query <;>
      simp_all [balance,setBalance,other,Ne.symm]
theorem totalSet (addr v : Nat) (b : Balances) :
    total (setBalance addr v b) + balance addr b = total b + v := by
  have split := splitTotal addr b
  change v+total (other addr b)+balance addr b = total b+v
  omega
theorem mint (addr a : Nat) (b : Balances) :
    total (setBalance addr (balance addr b+a) b) = total b + a := by
  have h := totalSet addr (balance addr b+a) b
  omega
theorem burn (addr a : Nat) (b : Balances) (enough : a≤balance addr b) :
    total (setBalance addr (balance addr b-a) b) = total b - a := by
  have h := totalSet addr (balance addr b-a) b
  omega
def move (src dst a : Nat) (b : Balances) : Balances :=
  let debited := setBalance src (balance src b-a) b
  setBalance dst (balance dst debited+a) debited
theorem movePreserves (src dst a : Nat) (b : Balances) (enough : a≤balance src b) :
    total (move src dst a b) = total b := by
  rw [move,mint,burn _ _ _ enough]
  have h := balanceLE src b
  omega
end Inv39
