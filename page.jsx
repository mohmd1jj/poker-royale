
export default function Home() {
  return (
    <main style={styles.page}>
      <div style={styles.overlay}></div>

      <section style={styles.hero}>
        <div style={styles.badge}>♠ Poker Royale</div>

        <h1 style={styles.title}>
          Play Smart.
          <br />
          Win Big.
        </h1>

        <p style={styles.subtitle}>
          Real-time Texas Hold'em experience with voice chat,
          multiplayer tables and smooth gameplay.
        </p>

        <div style={styles.buttons}>
          <button style={styles.primaryBtn}>Start Playing</button>
          <button style={styles.secondaryBtn}>Watch Demo</button>
        </div>
      </section>

      <section style={styles.cards}>
        <div style={styles.card}>
          <h3>🎮 Multiplayer</h3>
          <p>Join live poker rooms and challenge real players.</p>
        </div>

        <div style={styles.card}>
          <h3>🎤 Voice Chat</h3>
          <p>Talk with friends during gameplay using WebRTC.</p>
        </div>

        <div style={styles.card}>
          <h3>🏆 Ranked Tables</h3>
          <p>Climb the leaderboard and become the poker king.</p>
        </div>
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background:
      "linear-gradient(135deg, #0f172a 0%, #111827 40%, #14532d 100%)",
    color: "white",
    fontFamily: "Arial, sans-serif",
    padding: "40px 20px",
    position: "relative",
    overflow: "hidden",
  },

  overlay: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(circle at top right, rgba(34,197,94,0.2), transparent 40%)",
  },

  hero: {
    maxWidth: "900px",
    margin: "0 auto",
    textAlign: "center",
    position: "relative",
    zIndex: 1,
    paddingTop: "80px",
  },

  badge: {
    display: "inline-block",
    background: "#16a34a",
    color: "white",
    padding: "10px 18px",
    borderRadius: "999px",
    marginBottom: "20px",
    fontWeight: "bold",
  },

  title: {
    fontSize: "64px",
    lineHeight: 1.1,
    marginBottom: "20px",
    fontWeight: "bold",
  },

  subtitle: {
    fontSize: "20px",
    color: "#d1d5db",
    maxWidth: "650px",
    margin: "0 auto 40px",
    lineHeight: 1.7,
  },

  buttons: {
    display: "flex",
    justifyContent: "center",
    gap: "16px",
    flexWrap: "wrap",
  },

  primaryBtn: {
    background: "#22c55e",
    color: "#000",
    border: "none",
    padding: "14px 28px",
    borderRadius: "12px",
    fontWeight: "bold",
    fontSize: "16px",
    cursor: "pointer",
  },

  secondaryBtn: {
    background: "transparent",
    color: "white",
    border: "1px solid #4b5563",
    padding: "14px 28px",
    borderRadius: "12px",
    fontWeight: "bold",
    fontSize: "16px",
    cursor: "pointer",
  },

  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "20px",
    maxWidth: "1100px",
    margin: "100px auto 0",
    position: "relative",
    zIndex: 1,
  },

  card: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "20px",
    padding: "28px",
    backdropFilter: "blur(8px)",
  },
};
