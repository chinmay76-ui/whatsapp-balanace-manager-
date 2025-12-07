// frontend/src/App.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import LoanManager from "./components/LoanManager";

const API = import.meta.env.VITE_API || "http://localhost:5000";

const formatDate = (d) => (d ? new Date(d).toLocaleString() : "—");
const fmtMoney = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "₹0";
  return `₹${Number(n).toLocaleString()}`;
};

export default function App() {
  const [friends, setFriends] = useState([]);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [total, setTotal] = useState("");
  const [savedAmount, setSavedAmount] = useState(""); // optional saved amount
  const [selectedId, setSelectedId] = useState(null);

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const [transactions, setTransactions] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(false);

  useEffect(() => {
    fetchFriends();
  }, []);

  async function fetchFriends() {
    try {
      setLoadingFriends(true);
      const res = await axios.get(`${API}/api/friends`);
      setFriends(res.data || []);
      // keep selectedId valid
      if (res.data && res.data.length && !res.data.find((f) => f._id === selectedId)) {
        setSelectedId(res.data[0]._id);
      }
    } catch (err) {
      console.error(err);
      alert("Error fetching friends");
    } finally {
      setLoadingFriends(false);
    }
  }

  async function addFriend(e) {
    e.preventDefault();
    if (!name || !whatsapp) return alert("Name + WhatsApp required");

    try {
      await axios.post(`${API}/api/friends`, {
        name,
        whatsapp,
        totalBalance: Number(total) || 0,
        // only send savedAmount if user entered it
        savedAmount: savedAmount !== "" ? Number(savedAmount) : undefined,
      });

      setName("");
      setWhatsapp("");
      setTotal("");
      setSavedAmount("");
      fetchFriends();
    } catch (err) {
      console.error(err);
      alert("Error adding friend");
    }
  }

  // DELETE friend function
  async function deleteFriend(id) {
    if (
      !window.confirm(
        "Are you sure you want to delete this friend and all their transactions? This cannot be undone."
      )
    ) {
      return;
    }

    try {
      await axios.delete(`${API}/api/friends/${id}`);
      if (selectedId === id) setSelectedId(null);
      fetchFriends();
      alert("Friend deleted successfully");
    } catch (err) {
      console.error(err);
      alert("Error deleting friend");
    }
  }

  const selectedFriend = friends.find((f) => f._id === selectedId) || null;

  // Preview calculations
  const previewPrev = selectedFriend ? Number(selectedFriend.totalBalance || 0) : 0;
  const previewAmt = Number(amount) || 0;
  const previewAvailable = previewPrev - previewAmt;

  // SEND / DEDUCT money endpoint (uses backend route /api/friends/:id/deduct)
  async function sendMoney(e) {
    e?.preventDefault();
    if (!selectedFriend) return alert("Select a friend first");
    if (!amount || Number(amount) <= 0) return alert("Enter a valid amount");

    const confirmMsg = `Confirm transaction:
Name: ${selectedFriend.name}
Fixed saved amount: ${fmtMoney(selectedFriend.savedAmount)}
Previous balance: ${fmtMoney(previewPrev)}
Debit amount: ${fmtMoney(previewAmt)}
Available balance after debit: ${fmtMoney(previewAvailable)}
Note: ${note || "—"}

Proceed ?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      // POST to deduct route - backend will create a debit transaction and optionally send WhatsApp if implemented
      const res = await axios.post(`${API}/api/friends/${selectedFriend._id}/deduct`, {
        amount: previewAmt,
        note,
      });

      setAmount("");
      setNote("");
      await fetchFriends();

      // res may contain send result; handle gracefully
      if (res.data && res.data.sent) {
        // if your backend returns a field `sent` with details of UltraMsg response, adapt this.
        alert("Operation completed. Message send result: " + JSON.stringify(res.data.sent));
      } else {
        alert("Operation completed.");
      }
    } catch (err) {
      console.error(err);
      // Extract message if possible
      const msg = err?.response?.data?.error || err?.message || "Error sending money";
      alert(msg);
    }
  }

  // Update balance using PUT /api/friends/:id with totalBalance
  async function updateBalance(id) {
    const newBal = prompt("Enter new balance:");
    if (newBal === null) return;
    if (String(newBal).trim() === "" || Number.isNaN(Number(newBal)))
      return alert("Invalid number");

    try {
      await axios.put(`${API}/api/friends/${id}`, {
        totalBalance: Number(newBal),
      });
      fetchFriends();
    } catch (err) {
      console.error(err);
      alert("Error updating balance");
    }
  }

  // Edit savedAmount using PUT /api/friends/:id with savedAmount
  async function editSavedAmount(id, current) {
    const input = prompt("Enter fixed saved amount:", String(current || 0));
    if (input === null) return;
    if (String(input).trim() === "" || Number.isNaN(Number(input)))
      return alert("Invalid number");

    try {
      await axios.put(`${API}/api/friends/${id}`, { savedAmount: Number(input) });
      fetchFriends();
    } catch (err) {
      console.error(err);
      alert("Error updating saved amount");
    }
  }

  // View transactions (assumes route GET /api/friends/:id/transactions exists)
  async function viewTransactions(id) {
    try {
      const res = await axios.get(`${API}/api/friends/${id}/transactions`);
      // API might return { transactions: [...] } or an array directly; normalize:
      const txs = Array.isArray(res.data) ? res.data : res.data.transactions || res.data;
      setTransactions(txs || []);
      setShowModal(true);
    } catch (err) {
      console.error(err);
      alert("Error loading transactions");
    }
  }

  return (
    <div
      className="app-root"
      style={{
        minHeight: "100vh",
        padding: "16px",
        boxSizing: "border-box",
        background: "#f5f7fb",
      }}
    >
      <div
        className="app-container"
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: "12px",
          padding: "16px",
          boxShadow: "0 8px 20px rgba(0,0,0,0.05)",
          boxSizing: "border-box",
        }}
      >
        <h1
          style={{
            fontSize: "1.6rem",
            marginBottom: "16px",
            textAlign: "center",
            wordBreak: "break-word",
          }}
        >
          WhatsApp Balance Manager
        </h1>

        {/* Main responsive layout: stack on mobile */}
        <div
          className="app-grid"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          {/* Send money at the top */}
          <div
            className="send-section"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div
              className="card"
              style={{
                marginBottom: 0,
                padding: "12px",
                borderRadius: "10px",
                border: "1px solid #e2e8f0",
                background: "#f9fafb",
              }}
            >
              <h3 style={{ marginBottom: "8px", fontSize: "1.1rem" }}>Send Money</h3>
              <form
                onSubmit={sendMoney}
                style={{
                  display: "grid",
                  gap: 8,
                  gridTemplateColumns: "1fr",
                }}
              >
                <input
                  className="input"
                  placeholder="Amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{ padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                />

                <input
                  className="input"
                  placeholder="Note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                />

                {/* Preview box */}
                {selectedFriend && amount && !Number.isNaN(previewAmt) && (
                  <div
                    style={{
                      margin: "10px 0",
                      padding: 12,
                      borderRadius: 8,
                      background: "#f8fafb",
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        marginBottom: 8,
                        fontSize: "0.95rem",
                      }}
                    >
                      Preview
                    </div>
                    <div className="small" style={{ fontSize: "0.85rem" }}>
                      Name: {selectedFriend.name}
                    </div>
                    <div className="small" style={{ fontSize: "0.85rem" }}>
                      Fixed saved amount: {fmtMoney(selectedFriend.savedAmount)}
                    </div>
                    <div className="small" style={{ fontSize: "0.85rem" }}>
                      Previous balance: {fmtMoney(previewPrev)}
                    </div>
                    <div className="small" style={{ fontSize: "0.85rem" }}>
                      Debit amount: {fmtMoney(previewAmt)}
                    </div>
                    <div className="small" style={{ fontSize: "0.85rem" }}>
                      Available balance: {fmtMoney(previewAvailable)}
                    </div>
                  </div>
                )}

                <button
                  className="btn"
                  type="submit"
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "none",
                    background: "#16a34a",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Send & Notify
                </button>
              </form>
            </div>
          </div>

          {/* Left column: Add friend + Friends list */}
          <div
            className="left-column"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {/* Add Friend */}
            <div
              className="card"
              style={{
                marginBottom: 0,
                padding: "12px",
                borderRadius: "10px",
                border: "1px solid #e2e8f0",
                background: "#f9fafb",
              }}
            >
              <h3 style={{ marginBottom: "8px", fontSize: "1.1rem" }}>Add Friend</h3>
              <form
                onSubmit={addFriend}
                style={{
                  display: "grid",
                  gap: 8,
                  gridTemplateColumns: "1fr",
                }}
              >
                <input
                  className="input"
                  placeholder="Friend Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                />

                <input
                  className="input"
                  placeholder="+919876543210"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  style={{ padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                />

                <input
                  className="input"
                  placeholder="Starting Balance"
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                  style={{ padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                />

                <input
                  className="input"
                  placeholder="Saved amount (optional, defaults to starting balance)"
                  value={savedAmount}
                  onChange={(e) => setSavedAmount(e.target.value)}
                  style={{ padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                />

                <button
                  className="btn"
                  type="submit"
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "none",
                    background: "#2563eb",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Add Friend
                </button>
              </form>
            </div>

            {/* Friend List */}
            <div
              className="card"
              style={{
                marginBottom: 0,
                padding: "12px",
                borderRadius: "10px",
                border: "1px solid #e2e8f0",
                background: "#f9fafb",
              }}
            >
              <h3 style={{ marginBottom: "8px", fontSize: "1.1rem" }}>Friends</h3>

              {loadingFriends && (
                <div className="small" style={{ fontSize: "0.85rem" }}>
                  Loading friends…
                </div>
              )}
              {!loadingFriends && friends.length === 0 && (
                <div className="small" style={{ fontSize: "0.85rem" }}>
                  No friends yet — add one above.
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
                {friends.map((f) => (
                  <div
                    key={f._id}
                    className="list-item"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      padding: 12,
                      borderRadius: "8px",
                      border: "1px solid #e5e7eb",
                      background: "#ffffff",
                    }}
                  >
                    <div>
                      <strong style={{ wordBreak: "break-word" }}>{f.name}</strong> <br />
                      <span className="small" style={{ fontSize: "0.85rem" }}>
                        {f.whatsapp}
                      </span>
                      <div
                        className="small"
                        style={{ marginTop: 6, fontSize: "0.85rem", color: "#4b5563" }}
                      >
                        Saved: {fmtMoney(f.savedAmount)} · Balance: {fmtMoney(f.totalBalance)} ·
                        Updated: {formatDate(f.lastUpdatedAt)}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "8px",
                        alignItems: "center",
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          fontSize: "0.85rem",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="radio"
                          name="friendSelect"
                          checked={selectedId === f._id}
                          onChange={() => setSelectedId(f._id)}
                        />
                        Select
                      </label>




                    <button
  onClick={() => viewTransactions(f._id)}
  style={{
    padding: "6px 12px",
    borderRadius: "6px",
    background: "#8b5cf6",      // purple-500
    border: "1px solid #7c3aed",// purple-600
    color: "white",
    cursor: "pointer",
    fontSize: "0.8rem",
    transition: "0.2s",
  }}
  onMouseEnter={(e) => (e.target.style.background = "#7c3aed")}
  onMouseLeave={(e) => (e.target.style.background = "#8b5cf6")}
>
  History
</button>


                      <button
                        className="btn"
                        onClick={() => deleteFriend(f._id)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "none",
                          background: "#e63946",
                          color: "#fff",
                          cursor: "pointer",
                          fontSize: "0.8rem",
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Loan Manager at the very bottom */}
          <div style={{ marginTop: 8 }}>
            <LoanManager />
          </div>
        </div>
      </div>

      {/* Modal for Transactions */}
      {showModal && (
        <div
          className="modal-bg"
          onClick={() => setShowModal(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "8px",
            boxSizing: "border-box",
          }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 720,
              maxHeight: "80vh",
              overflowY: "auto",
              background: "#fff",
              padding: 18,
              borderRadius: 10,
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "8px",
                marginBottom: "8px",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Transaction History</h3>
              <button
                className="btn"
                style={{
                  padding: "6px 10px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#ef4444",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  flexShrink: 0,
                }}
                onClick={() => setShowModal(false)}
              >
                Close
              </button>
            </div>

            <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
              {transactions.length === 0 && (
                <li className="small" style={{ fontSize: "0.85rem" }}>
                  No transactions found.
                </li>
              )}
              {transactions.map((t) => (
                <li
                  key={t._id}
                  style={{
                    marginBottom: "12px",
                    borderBottom: "1px solid #f1f1f1",
                    paddingBottom: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "8px",
                      alignItems: "flex-start",
                    }}
                  >
                    <strong style={{ wordBreak: "break-word" }}>{fmtMoney(t.amount)}</strong>
                    <div
                      className="small"
                      style={{ fontSize: "0.8rem", color: "#6b7280", whiteSpace: "nowrap" }}
                    >
                      {formatDate(t.date || t.createdAt)}
                    </div>
                  </div>
                  <div
                    className="small"
                    style={{ marginTop: 6, fontSize: "0.85rem", color: "#4b5563" }}
                  >
                    {t.note || t.reason || "—"}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
