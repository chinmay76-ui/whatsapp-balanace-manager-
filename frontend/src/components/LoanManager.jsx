import React, { useEffect, useState } from "react";

const API = import.meta.env.VITE_API || "http://localhost:5000";

export default function LoanManager() {
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState("");
  const [loans, setLoans] = useState([]);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  // New friend fields
  const [newName, setNewName] = useState("");
  const [newWhatsapp, setNewWhatsapp] = useState("");

  useEffect(() => {
    loadFriends();
  }, []);

  useEffect(() => {
    if (selected) loadLoans(selected);
  }, [selected]);

  async function loadFriends() {
    try {
      const res = await fetch(`${API}/api/friends`);
      const data = await res.json();
      setFriends(data || []);
      if (!selected && data && data.length) setSelected(data[0]._id);
    } catch (err) {
      console.error("loadFriends:", err);
    }
  }

  async function loadLoans(friendId) {
    if (!friendId) return setLoans([]);
    try {
      const res = await fetch(`${API}/api/loans/friend/${friendId}`);
      const data = await res.json();
      setLoans(data.txs || []);
    } catch (err) {
      console.error("loadLoans:", err);
    }
  }

  // Add a new friend (manual input)
  async function addFriend(e) {
    e?.preventDefault();
    const name = (newName || "").trim();
    const whatsapp = (newWhatsapp || "").trim();

    if (!name) return alert("Please enter friend name");
    if (!whatsapp) return alert("Please enter WhatsApp number (e.g. +919876543210)");

    try {
      const payload = { name, whatsapp, totalBalance: 0 };
      const res = await fetch(`${API}/api/friends`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert("Failed to add friend: " + (err.error || res.statusText));
      }
      const created = await res.json();
      await loadFriends();
      setSelected(created._id || created._doc?._id || "");
      setNewName("");
      setNewWhatsapp("");
      if (created._id || created._doc?._id) {
        loadLoans(created._id || created._doc._id);
      }
    } catch (err) {
      console.error("addFriend:", err);
      alert("Error adding friend");
    }
  }

  // Add loan entry
  async function addLoan(e) {
    e.preventDefault();
    if (!selected) return alert("Select or add a friend first");
    const amt = Number(amount);
    if (!amt || amt <= 0) return alert("Enter a valid amount");
    try {
      const res = await fetch(`${API}/api/loans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendId: selected, amount: amt, reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert("Failed to add loan: " + (err.error || res.statusText));
      }
      setAmount("");
      setReason("");
      await loadLoans(selected);
      await loadFriends();
    } catch (err) {
      console.error("addLoan:", err);
      alert("Error adding loan");
    }
  }

  // Delete loan
  async function deleteLoan(id) {
    if (!confirm("Delete this loan?")) return;
    try {
      const res = await fetch(`${API}/api/loans/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert("Delete failed: " + (err.error || res.statusText));
      }
      await loadLoans(selected);
      await loadFriends();
    } catch (err) {
      console.error("deleteLoan:", err);
    }
  }

  // Notify for a loan entry (exact reminder message for that loan)
  async function sendNotifyLoan(id) {
    try {
      const res = await fetch(`${API}/api/loans/${id}/notify`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert("Notify failed: " + (err.error || res.statusText));
      }
      alert("Reminder sent for that loan entry!");
    } catch (err) {
      console.error("sendNotifyLoan:", err);
      alert("Error sending reminder");
    }
  }

  // --- NEW: Notify selected friend for TOTAL owed ---
  async function notifyFriendTotal() {
    if (!selected) return alert("Select a friend first");
    const friend = friends.find((f) => f._id === selected);
    const owed = Number(friend?.owedAmount || 0);
    if (owed <= 0) return alert("Selected friend does not owe anything.");

    const confirmMsg = `Send total owed reminder to ${friend.name} for ₹${owed}?`;
    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetch(`${API}/api/loans/friend/${selected}/notify`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert("Total notify failed: " + (err.error || res.statusText));
      }
      alert("Total reminder sent to " + friend.name);
    } catch (err) {
      console.error("notifyFriendTotal:", err);
      alert("Error sending total reminder");
    }
  }

  // Quick UI helper to render friend buttons list
  function FriendList() {
    if (!friends.length)
      return (
        <div className="small" style={{ fontSize: "0.85rem" }}>
          No friends yet. Add one above.
        </div>
      );
    return (
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginTop: 8,
        }}
      >
        {friends.map((f) => (
          <button
            key={f._id}
            className="btn"
            onClick={() => setSelected(f._id)}
            style={{
              background: selected === f._id ? "#0077cc" : "#f2f2f2",
              color: selected === f._id ? "#fff" : "#000",
              border: "none",
              padding: "6px 10px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: "0.85rem",
              whiteSpace: "nowrap",
            }}
          >
            {f.name} (₹{f.owedAmount || 0})
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{
        marginTop: 30,
        padding: 16,
        borderRadius: 12,
        border: "1px solid #e5e7eb",
        background: "#ffffff",
      }}
    >
      <h3 style={{ marginBottom: 8, fontSize: "1.1rem" }}>🔁 Loans Manager</h3>

      {/* Add friend inline – stack on small screens */}
      <form
        onSubmit={addFriend}
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <input
          className="input"
          placeholder="Friend name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{
            minWidth: 0,
            flex: "1 1 150px",
            padding: "8px",
            borderRadius: 6,
            border: "1px solid #cbd5e1",
          }}
        />
        <input
          className="input"
          placeholder="WhatsApp (e.g. +919876543210)"
          value={newWhatsapp}
          onChange={(e) => setNewWhatsapp(e.target.value)}
          style={{
            minWidth: 0,
            flex: "1 1 180px",
            padding: "8px",
            borderRadius: 6,
            border: "1px solid #cbd5e1",
          }}
        />
        <button
          className="btn"
          type="submit"
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "none",
            background: "#2563eb",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Add Friend
        </button>
       <button
  type="button"
  onClick={() => {
    setNewName("");
    setNewWhatsapp("");
  }}
  style={{
    background: "#f3f4f6",      // light gray
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1px solid #d1d5db",
    cursor: "pointer",
    fontSize: "0.85rem",
    transition: "0.2s ease",
  }}
  onMouseEnter={(e) => (e.target.style.background = "#e5e7eb")}
  onMouseLeave={(e) => (e.target.style.background = "#f3f4f6")}
>
  Clear
</button>

      </form>

      {/* Existing friends (select quickly) */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Choose / Switch friend</div>
        <FriendList />
      </div>

      {/* Selected friend's owed summary + Total reminder button */}
      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 220px" }}>
          <div style={{ fontWeight: 600 }}>
            Selected: {selected ? friends.find((x) => x._id === selected)?.name || "—" : "—"}
          </div>
          <div className="small" style={{ fontSize: "0.85rem" }}>
            Overall owed: ₹
            {friends.reduce((s, f) => s + Number(f.owedAmount || 0), 0)}
          </div>
          <div className="small" style={{ fontSize: "0.85rem" }}>
            Selected owes: ₹
            {selected ? friends.find((x) => x._id === selected)?.owedAmount || 0 : 0}
          </div>
        </div>

        {/* Total reminder button */}
        <div
          style={{
            marginLeft: "auto",
            flexShrink: 0,
          }}
        >
          <button
            className="btn"
            onClick={notifyFriendTotal}
            disabled={
              !selected ||
              Number((friends.find((f) => f._id === selected) || {}).owedAmount) <= 0
            }
            style={{
              background: "#0077cc",
              color: "#fff",
              border: "none",
              padding: "8px 12px",
              borderRadius: 8,
              cursor: "pointer",
              opacity:
                !selected ||
                Number((friends.find((f) => f._id === selected) || {}).owedAmount) <= 0
                  ? 0.6
                  : 1,
              fontSize: "0.9rem",
              whiteSpace: "nowrap",
            }}
          >
            🔔 Total reminder
          </button>
        </div>
      </div>

      {/* Add loan – responsive row that wraps */}
      <form
        onSubmit={addLoan}
        style={{
          marginTop: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        <label
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
            fontSize: "0.9rem",
          }}
        >
          Amount (₹)
          <input
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{
              width: 120,
              maxWidth: "100%",
              padding: "8px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
            }}
          />
        </label>

        <input
          className="input"
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{
            flex: "1 1 180px",
            minWidth: 0,
            padding: "8px",
            borderRadius: 6,
            border: "1px solid #cbd5e1",
          }}
        />

        <button
          className="btn"
          type="submit"
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "none",
            background: "#16a34a",
            color: "#fff",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Add Loan
        </button>
      </form>

      <hr style={{ margin: "16px 0" }} />

      <h4 style={{ fontSize: "1rem", marginBottom: 8 }}>Loan entries for selected friend</h4>
      {(!loans || loans.length === 0) && (
        <div className="small" style={{ fontSize: "0.85rem" }}>
          No loan entries.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {loans.map((t) => (
          <div
            key={t._id}
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              gap: 8,
              padding: "8px 0",
              borderBottom: "1px solid #eee",
            }}
          >
            <div style={{ minWidth: 0, flex: "1 1 200px" }}>
              <div style={{ fontWeight: 700 }}>₹{t.amount}</div>
              <div className="small" style={{ fontSize: "0.85rem" }}>
                {t.reason || "—"}
              </div>
              <div className="small" style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                {new Date(t.createdAt).toLocaleString()}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
                justifyContent: "flex-end",
                flex: "0 0 auto",
              }}
            >
             <button
  onClick={() => sendNotifyLoan(t._id)}
  style={{
    padding: "6px 12px",
    borderRadius: "6px",
    background: "#8b5cf6",       // purple-500
    border: "1px solid #7c3aed", // purple-600
    color: "white",
    cursor: "pointer",
    fontSize: "0.85rem",
    whiteSpace: "nowrap",
    transition: "0.2s",
  }}
  onMouseEnter={(e) => (e.target.style.background = "#7c3aed")}
  onMouseLeave={(e) => (e.target.style.background = "#8b5cf6")}
>
  Notify
</button>

              <button
                className="btn"
                onClick={() => deleteLoan(t._id)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "none",
                  background: "#e63946",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  whiteSpace: "nowrap",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
